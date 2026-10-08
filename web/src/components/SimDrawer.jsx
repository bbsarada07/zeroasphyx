import { useEffect, useState } from 'react';
import { FlaskConical, RotateCcw, X } from 'lucide-react';
import { useLive } from '../lib/live';
import { post } from '../lib/api';
import { fmtTime } from '../lib/format';
import { Button, ErrorNote, StatusPill } from './ui';
import { MqttDot, SourceToggle } from './Header';

const GROUPS = [
  ['Pre-entry test', [
    ['safe-descent', 'Safe descent', 'GRANTED'],
    ['open-air', 'Open-air cheat (no descent)', 'PROBE_NOT_LOWERED'],
    ['unsafe-gas', 'Unsafe gas at depth', 'UNSAFE_GAS'],
    ['replay', 'Replay an old reading', 'INVALID_SESSION'],
    ['wrong-location', 'Wrong location', 'WRONG_LOCATION'],
  ]],
  ['During the job', [
    ['gas-spike', 'Gas spike during job', 'REVOKED + EVACUATE'],
    ['man-down', 'Man down', 'INCIDENT'],
    ['sos', 'SOS', 'INCIDENT'],
  ]],
];

function lastRunSummary(r) {
  if (!r) return null;
  if (r.decision) return { status: r.decision, text: r.decision === 'GRANTED' ? `Permit ${r.permitId}` : `${r.reason}: ${r.detail}` };
  if (r.permitStatus) return { status: r.permitStatus, text: `Permit ${r.permitId} ${r.permitStatus}, EVACUATE alert` };
  if (r.incidentId) return { status: 'WARNING', text: `${r.cause} incident ${r.incidentId} on ${r.permitId}` };
  return null;
}

export default function SimDrawer() {
  const { live, drawerOpen, setDrawerOpen, cfg } = useLive();
  const [error, setError] = useState(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, setDrawerOpen]);

  if (!drawerOpen) return null;
  const sim = live?.sim;
  const isSim = live?.mode === 'SIM';
  const running = sim?.running;
  const summary = lastRunSummary(sim?.lastRun);

  const run = async (name) => {
    setError(null);
    try { await post(`/sim/${name}`); } catch (e) { setError(e.message); }
  };
  const reset = async () => {
    if (!window.confirm('Reset all demo data to the seed state?')) return;
    setResetting(true);
    setError(null);
    try { await post('/demo/reset'); } catch (e) { setError(e.message); } finally { setResetting(false); }
  };

  const beacon = sim?.beacon;
  return (
    <div className="fixed inset-0 z-[90] print:hidden">
      <button type="button" aria-label="Close simulator" className="absolute inset-0 bg-slate-950/40" onClick={() => setDrawerOpen(false)} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl" aria-label="Simulator">
        <div className="flex items-center justify-between bg-slate-950 px-5 py-4 text-white">
          <h2 className="flex items-center gap-2 text-xl font-black"><FlaskConical className="h-6 w-6 text-amber-400" aria-hidden /> Simulator</h2>
          <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Close simulator">
            <X className="h-6 w-6" aria-hidden />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div className="space-y-2 rounded-2xl bg-slate-950 p-4 text-white">
            <p className="text-sm font-bold text-slate-300">Data source</p>
            <SourceToggle large />
            <div><MqttDot /></div>
            <p className="text-sm text-slate-300">
              {isSim
                ? 'SIM: scenarios below are fed through the same ingestion code as Wokwi, signed with the real device secrets. MQTT input is ignored.'
                : `LIVE: listening to Wokwi on ${cfg?.mqtt?.prefix || 'the broker'}. Switch to SIM to run scenarios.`}
            </p>
          </div>

          {GROUPS.map(([title, items]) => (
            <div key={title}>
              <h3 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-500">{title}</h3>
              <div className="grid gap-2">
                {items.map(([id, label, expect]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={!isSim || Boolean(running)}
                    onClick={() => run(id)}
                    className="flex items-center justify-between gap-3 rounded-xl border-2 border-slate-200 px-4 py-3 text-left font-bold text-slate-900 hover:border-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>{running === id ? `${label}…` : label}</span>
                    <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">{expect}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500">
            Pre-entry scenarios answer the pending test started on Live Operations; if there is none they start one at {cfg?.simDefaults?.manholeId || 'MH-001'} with {cfg?.simDefaults?.deviceId || 'PROBE-001'}. Job scenarios open a job first if needed.
          </p>
          <ErrorNote>{error}</ErrorNote>

          {summary && (
            <div className="rounded-2xl border-2 border-slate-200 p-4">
              <p className="mb-2 text-sm font-black uppercase tracking-wider text-slate-500">Last run · {sim.lastRun.label} · {fmtTime(sim.lastRun.ts)}</p>
              <StatusPill status={summary.status} label={summary.status === 'WARNING' ? 'INCIDENT' : undefined} />
              <p className="mt-2 text-sm font-semibold text-slate-700">{summary.text}</p>
            </div>
          )}

          {beacon && (
            <div className="rounded-2xl border-2 border-slate-200 p-4 text-sm">
              <p className="mb-2 font-black uppercase tracking-wider text-slate-500">Simulated {cfg?.beaconId || 'BEACON-001'}</p>
              <p className="font-semibold text-slate-700">
                {isSim && live?.job ? `Streaming every 2 s for ${live.job.id}` : 'Idle (streams only in SIM while a job is open)'}
              </p>
              <p className="mt-1 font-semibold">
                Siren: <span className={beacon.siren ? 'font-black text-red-700' : 'text-slate-700'}>{beacon.siren ? 'ON' : 'off'}</span>
                {' · '}Motion: {beacon.moving ? 'moving' : 'STILL'}{beacon.sos ? ' · SOS' : ''}
              </p>
            </div>
          )}

          {live?.deviceLog?.length > 0 && (
            <div className="rounded-2xl border-2 border-slate-200 p-4">
              <p className="mb-2 text-sm font-black uppercase tracking-wider text-slate-500">Server → device messages</p>
              <ul className="space-y-1.5 font-mono text-xs">
                {live.deviceLog.slice(0, 6).map((m, i) => (
                  <li key={i} className="break-all">
                    <span className="text-slate-500">{fmtTime(m.ts)}</span>{' '}
                    <span className="font-bold">{m.topic.split('/').slice(-3).join('/')}</span>{' '}
                    {JSON.stringify(m.payload)}{' '}
                    <span className={m.delivered ? 'text-emerald-700' : 'text-slate-400'}>{m.delivered ? '[MQTT sent]' : '[not sent: SIM/offline]'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button variant="redOutline" className="w-full" onClick={reset} disabled={resetting}>
            <RotateCcw className="h-5 w-5" aria-hidden /> {resetting ? 'Resetting…' : 'Reset demo data'}
          </Button>
        </div>
      </aside>
    </div>
  );
}
