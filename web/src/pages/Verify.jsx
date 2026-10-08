import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, CircleCheck, CircleHelp, Clock, Lock, Search } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime, fmtTime } from '../lib/format';

const LOOK = {
  VALID: ['bg-emerald-700 text-white', CircleCheck, 'VALID', 'Entry permitted until the time below.'],
  EXPIRED: ['bg-amber-500 text-slate-950', Clock, 'EXPIRED', 'This permit is no longer valid. A new gas test is required before entry.'],
  REVOKED: ['bg-red-700 text-white', Ban, 'REVOKED', 'Unsafe conditions were detected. Nobody may enter.'],
  CLOSED: ['bg-slate-700 text-white', Lock, 'CLOSED', 'The job is finished. This permit is not valid for entry.'],
  NOT_FOUND: ['bg-slate-200 text-slate-900', CircleHelp, 'NOT FOUND', 'No permit with this ID exists. Do not allow entry.'],
};

function Lookup({ initial = '' }) {
  const [q, setQ] = useState(initial);
  const navigate = useNavigate();
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/verify/${encodeURIComponent(q.trim().toUpperCase())}`); }} className="flex gap-2">
      <label className="sr-only" htmlFor="permit-id">Permit ID</label>
      <input
        id="permit-id"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Permit ID, e.g. PRM-H7K2Q9"
        className="min-w-0 flex-1 rounded-xl border-2 border-slate-300 px-4 py-3 font-mono text-lg uppercase focus:border-sky-600 focus:outline-none"
      />
      <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-lg font-bold text-white hover:bg-slate-700">
        <Search className="h-5 w-5" aria-hidden /> Check
      </button>
    </form>
  );
}

export default function Verify() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    const load = () => api(`/verify/${encodeURIComponent(id)}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e.message); });
    setData(null);
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [id]);

  const [cls, Icon, word, note] = data ? LOOK[data.status] || LOOK.NOT_FOUND : [];
  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-black">Verify an entry permit</h1>
        <p className="font-semibold text-slate-600">Public check. No login needed. Scan the QR code on the permit or type its ID.</p>
      </div>
      {!id && <Lookup />}
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 font-semibold text-red-800">Could not check the permit: {error}</p>}
      {id && !data && !error && <div className="h-64 animate-pulse rounded-3xl bg-slate-200" />}
      {data && (
        <div className="overflow-hidden rounded-3xl border-2 border-slate-200 bg-white shadow-sm">
          <div className={`flex flex-col items-center gap-2 px-6 py-10 text-center ${cls}`} role="status">
            <Icon className="h-24 w-24" strokeWidth={2.5} aria-hidden />
            <p className="text-6xl font-black tracking-tight">{word}</p>
            <p className="text-lg font-semibold">{note}</p>
          </div>
          <dl className="space-y-3 p-6 text-lg">
            <div><dt className="text-sm font-bold uppercase text-slate-500">Permit</dt><dd className="font-mono text-xl font-black">{data.permitId}</dd></div>
            {data.manhole && (
              <div><dt className="text-sm font-bold uppercase text-slate-500">Manhole</dt><dd className="font-bold">{data.manhole.id}{data.manhole.address ? ` · ${data.manhole.address}` : ''}</dd></div>
            )}
            {data.issuedAt && <div><dt className="text-sm font-bold uppercase text-slate-500">Issued</dt><dd className="font-bold">{fmtDateTime(data.issuedAt)}</dd></div>}
            {data.expiresAt && <div><dt className="text-sm font-bold uppercase text-slate-500">Valid until</dt><dd className="font-bold">{fmtDateTime(data.expiresAt)}</dd></div>}
            {data.revokedAt && <div><dt className="text-sm font-bold uppercase text-slate-500">Revoked</dt><dd className="font-bold">{fmtDateTime(data.revokedAt)}</dd></div>}
            {data.closedAt && <div><dt className="text-sm font-bold uppercase text-slate-500">Job closed</dt><dd className="font-bold">{fmtDateTime(data.closedAt)}</dd></div>}
            <p className="text-sm font-semibold text-slate-500">Checked {fmtTime(data.checkedAt)} · refreshes every 5 s</p>
          </dl>
        </div>
      )}
      {id && <Lookup key={id} />}
    </div>
  );
}
