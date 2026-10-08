import { Trophy } from 'lucide-react';
import { useApiData } from '../lib/live';
import { ErrorNote } from '../components/ui';

function tone(pct) {
  if (pct >= 80) return ['bg-emerald-700', 'text-emerald-800 dark:text-emerald-400', 'Compliant'];
  if (pct >= 50) return ['bg-amber-500', 'text-amber-800 dark:text-amber-400', 'Needs attention'];
  return ['bg-red-700', 'text-red-800 dark:text-red-400', 'Non-compliant'];
}

export default function Scoreboard() {
  const { data, error } = useApiData('/scoreboard');
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight"><Trophy className="h-8 w-8" aria-hidden /> Contractor scoreboard</h1>
        <p className="mt-1 text-lg font-semibold text-slate-600 dark:text-slate-300">Compliance = billed jobs backed by a clean permit (closed, no incident) ÷ all billed jobs.</p>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="grid gap-5 md:grid-cols-2">
        {(data || []).map((c) => {
          const [bar, text, label] = tone(c.compliancePct);
          const stats = [
            ['Jobs billed', c.jobs], ['Permits granted', c.permitsGranted], ['Denials', c.denials],
            ['Revocations', c.revocations], ['Incidents', c.incidents], ['Rejected bills', c.rejectedBills],
          ];
          return (
            <article key={c.contractorId} className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{c.contractorId}</p>
              <h2 className="text-2xl font-black">{c.name}</h2>
              <div className="mt-4 flex items-end justify-between gap-3">
                <p className={`text-7xl font-black tabular-nums leading-none ${text}`}>{c.compliancePct}%</p>
                <p className={`text-lg font-black ${text}`}>{label}</p>
              </div>
              <div className="mt-3 h-4 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="img" aria-label={`${c.compliancePct}% compliant`}>
                <div className={`h-full ${bar}`} style={{ width: `${c.compliancePct}%` }} />
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">{c.compliantJobs} of {c.jobs} billed jobs compliant</p>
              <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {stats.map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800">
                    <dd className="text-3xl font-black tabular-nums">{v}</dd>
                    <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{k}</dt>
                  </div>
                ))}
              </dl>
            </article>
          );
        })}
      </div>
    </div>
  );
}
