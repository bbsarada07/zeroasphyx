// Data-access module. Rows are cached in memory and written through to a backend:
// better-sqlite3 when it loads, otherwise a JSON file. Both backends expose the same interface.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { canonical } = require('./util');

const TABLES = [
  'manholes', 'contractors', 'workers', 'supervisors', 'devices',
  'sessions', 'readings', 'permits', 'incidents', 'bills', 'telemetry',
];

function sqliteBackend(file) {
  const Database = require('better-sqlite3');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  for (const t of TABLES) db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL,
    data TEXT NOT NULL, prevHash TEXT NOT NULL, hash TEXT NOT NULL)`);
  const upsert = {}, remove = {};
  for (const t of TABLES) {
    upsert[t] = db.prepare(`INSERT INTO ${t} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`);
    remove[t] = db.prepare(`DELETE FROM ${t} WHERE id = ?`);
  }
  const insertEvent = db.prepare('INSERT INTO events (seq, ts, type, data, prevHash, hash) VALUES (?, ?, ?, ?, ?, ?)');
  const updateEventData = db.prepare('UPDATE events SET data = ? WHERE seq = ?');
  const selectEvents = db.prepare('SELECT seq, ts, type, data, prevHash, hash FROM events ORDER BY seq');
  return {
    kind: 'sqlite',
    file,
    load() {
      const tables = {};
      for (const t of TABLES) tables[t] = db.prepare(`SELECT data FROM ${t} ORDER BY rowid`).all().map((r) => JSON.parse(r.data));
      return tables;
    },
    upsert: (t, row) => upsert[t].run(row.id, JSON.stringify(row)),
    remove: (t, id) => remove[t].run(id),
    appendEvent: (e) => insertEvent.run(e.seq, e.ts, e.type, canonical(e.data), e.prevHash, e.hash),
    updateEventData: (seq, data) => updateEventData.run(canonical(data), seq),
    readEvents: () => selectEvents.all().map((r) => ({ ...r, data: JSON.parse(r.data) })),
    clear() {
      db.transaction(() => {
        for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
        db.exec('DELETE FROM events');
      })();
    },
    batch: (fn) => db.transaction(fn)(),
    close: () => db.close(),
  };
}

function jsonBackend(file) {
  let doc = { tables: {}, events: [] };
  if (fs.existsSync(file)) {
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* corrupt file: start empty */ }
  }
  for (const t of TABLES) doc.tables[t] = doc.tables[t] || [];
  doc.events = doc.events || [];
  let depth = 0;
  const save = () => {
    if (depth > 0) return;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, file);
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return {
    kind: 'json',
    file,
    load() {
      const tables = {};
      for (const t of TABLES) tables[t] = clone(doc.tables[t]);
      return tables;
    },
    upsert(t, row) {
      const list = doc.tables[t];
      const i = list.findIndex((r) => r.id === row.id);
      if (i >= 0) list[i] = clone(row); else list.push(clone(row));
      save();
    },
    remove(t, id) {
      doc.tables[t] = doc.tables[t].filter((r) => r.id !== id);
      save();
    },
    appendEvent(e) {
      doc.events.push({ seq: e.seq, ts: e.ts, type: e.type, data: canonical(e.data), prevHash: e.prevHash, hash: e.hash });
      save();
    },
    updateEventData(seq, data) {
      const e = doc.events.find((x) => x.seq === seq);
      if (e) e.data = canonical(data);
      save();
    },
    readEvents: () => doc.events.map((e) => ({ ...e, data: JSON.parse(e.data) })),
    clear() {
      for (const t of TABLES) doc.tables[t] = [];
      doc.events = [];
      save();
    },
    batch(fn) {
      depth++;
      try { return fn(); } finally { depth--; save(); }
    },
    close() {},
  };
}

function openBackend() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (config.storage !== 'json') {
    try {
      return sqliteBackend(path.join(config.dataDir, 'zeroasphyx.db'));
    } catch (err) {
      console.warn(`[store] better-sqlite3 unavailable (${err.message.split('\n')[0]}); using JSON file store.`);
    }
  }
  return jsonBackend(path.join(config.dataDir, 'zeroasphyx.json'));
}

class Store {
  constructor() {
    this.backend = openBackend();
    this.tables = {};
    const loaded = this.backend.load();
    for (const t of TABLES) this.tables[t] = new Map(loaded[t].map((r) => [r.id, r]));
    this.events = this.backend.readEvents();
  }

  get kind() { return this.backend.kind; }
  all(t) { return [...this.tables[t].values()]; }
  get(t, id) { return id == null ? undefined : this.tables[t].get(id); }
  count(t) { return this.tables[t].size; }

  insert(t, row) {
    this.tables[t].set(row.id, row);
    this.backend.upsert(t, row);
    return row;
  }

  update(t, id, patch) {
    const cur = this.tables[t].get(id);
    if (!cur) return undefined;
    const row = { ...cur, ...patch };
    this.tables[t].set(id, row);
    this.backend.upsert(t, row);
    return row;
  }

  remove(t, id) {
    this.tables[t].delete(id);
    this.backend.remove(t, id);
  }

  // ---- tamper-evident event log (see audit.js)
  lastEvent() { return this.events[this.events.length - 1]; }
  allEvents() { return this.events; }
  appendEvent(e) {
    this.backend.appendEvent(e);
    this.events.push(e);
  }
  // Re-read the log from storage so verification checks what is actually on disk.
  readStoredEvents() { return this.backend.readEvents(); }
  overwriteEventData(seq, data) {
    this.backend.updateEventData(seq, data);
    const e = this.events.find((x) => x.seq === seq);
    if (e) e.data = data;
  }

  clear() {
    this.backend.clear();
    for (const t of TABLES) this.tables[t].clear();
    this.events = [];
  }

  batch(fn) { return this.backend.batch(fn); }
  close() { this.backend.close(); }
}

module.exports = { Store, TABLES };
