import { useEffect, useState } from 'react';
import { Fingerprint, Hammer, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useApiData } from '../lib/live';
import { api, post } from '../lib/api';
import { fmtDateTime, shortHash, summarizeEvent } from '../lib/format';
import { Button, ErrorNote } from '../components/ui';

export default function Audit() {
  const { data: events, error } = useApiData('/audit/events');
  const [result, setResult] = useState(null);
  const [tampered, setTampered] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const verify = async () => {
    setBusy(true);
    setErr(null);
    try { setResult({ ...(await api('/audit/verify')), at: Date.now() }); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  // Re-verify whenever the log changes, except right after a demo tamper (the presenter presses Verify).
  useEffect(() => {
    if (!events || (tampered && !result)) return;
    verify();
  }, [events]);

  const tamper = async () => {
    if (!window.confirm('Demo only: silently edit one stored audit record (without fixing its hash)?')) return;
    setErr(null);
    try {
      setTampered(await post('/demo/tamper'));
      setResult(null);
    } catch (e) { setErr(e.message); }
  };

  const broken = result && !result.ok ? result.brokenAt : null;
  const rows = [...(events || [])].reverse();

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight"><ScrollText className="h-8 w-8" aria-hidden /> Tamper-evident audit log</h1>
          <p className="mt-1 text-lg font-semibold text-slate-600">Each record stores the hash of the one before it. Editing any record breaks the chain from that point.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button size="lg" variant="primary" onClick={verify} disabled={busy}>
            <Fingerprint className="h-6 w-6" aria-hidden /> {busy ? 'Verifying…' : 'Verify chain'}
          </Button>
          <Button size="lg" variant="redOutline" onClick={tamper}>
            <Hammer className="h-6 w-6" aria-hidden /> Tamper with a record (demo)
          </Button>
        </div>
      </div>
      <ErrorNote>{error || err}</ErrorNote>

      {tampered && !result && (
        <div className="rounded-2xl bg-amber-100 px-5 py-4 text-lg font-bold text-amber-950 ring-2 ring-amber-500">
          Record #{tampered.seq} ({tampered.type}) was edited in the database: {tampered.description} Now press “Verify chain”.
        </div>
      )}
      {result && result.ok && (
        <div className="flex items-center gap-4 rounded-2xl bg-emerald-700 px-6 py-5 text-white" role="status">
          <ShieldCheck className="h-14 w-14 shrink-0" aria-hidden />
          <div>
            <p className="text-4xl font-black">CHAIN INTACT</p>
            <p className="text-lg font-semibold">All {result.count} records verified · head {shortHash(result.head)}</p>
          </div>
        </div>
      )}
      {result && !result.ok && (
        <div className="flex items-center gap-4 rounded-2xl bg-red-700 px-6 py-5 text-white" role="alert">
          <ShieldAlert className="h-14 w-14 shrink-0" aria-hidden />
          <div>
            <p className="text-4xl font-black">CHAIN BROKEN AT RECORD #{result.brokenAt}</p>
            <p className="text-lg font-semibold">{result.reason}. Records from #{result.brokenAt} onward can no longer be trusted, and bills that depend on them are refused.</p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border-2 border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">Time</th>
              <th className="px-3 py-3">Event</th>
              <th className="px-3 py-3">Details</th>
              <th className="px-3 py-3">Prev hash</th>
              <th className="px-3 py-3">Hash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const isBroken = broken === e.seq;
              const after = broken !== null && e.seq > broken;
              return (
                <tr key={e.seq} className={`border-t border-slate-100 align-top ${isBroken ? 'bg-red-700 text-white' : after ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-2 font-mono font-bold">{e.seq}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtDateTime(e.ts)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-md px-2 py-0.5 font-mono text-xs font-bold ${isBroken ? 'bg-white text-red-800' : 'bg-slate-100 text-slate-800'}`}>{e.type}</span>
                    {isBroken && <div className="mt-1 text-xs font-black">✖ BROKEN HERE</div>}
                  </td>
                  <td className="max-w-xl px-3 py-2 font-medium">{summarizeEvent(e)}</td>
                  <td className="px-3 py-2 font-mono text-xs" title={e.prevHash}>{shortHash(e.prevHash)}</td>
                  <td className="px-3 py-2 font-mono text-xs" title={e.hash}>{shortHash(e.hash)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
