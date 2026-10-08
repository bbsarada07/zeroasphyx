import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, FileText, Search } from 'lucide-react';
import { useApiData, useLive } from '../lib/live';
import { post } from '../lib/api';
import { contractorName, fmtDateTime, fmtJobDate, fmtMoney, manholeOf } from '../lib/format';
import { Button, ErrorNote, StatusPill } from '../components/ui';

export default function Payments() {
  const { refs, role } = useLive();
  const { data: bills, error } = useApiData('/bills');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const isOfficer = role === 'Municipal Officer';

  const review = async (id) => {
    setBusy(id);
    setErr(null);
    try { await post(`/bills/${id}/review`); } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight"><Banknote className="h-8 w-8" aria-hidden /> Contractor payments</h1>
          <p className="mt-1 text-lg font-semibold text-slate-600 dark:text-slate-300">A bill is paid only for a job with a valid permit, closed cleanly, with no incident, and an intact audit chain.</p>
        </div>
        {!isOfficer && <p className="rounded-xl bg-amber-100 px-3 py-2 text-sm font-bold text-amber-950 dark:bg-amber-950 dark:text-amber-100">Switch to the Municipal Officer role to review bills.</p>}
      </div>
      <ErrorNote>{error || err}</ErrorNote>

      <div className="space-y-4">
        {(bills || []).map((b) => {
          const m = manholeOf(refs, b.manholeId);
          return (
            <article key={b.id} className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xl font-black">{b.id}</span>
                    <StatusPill status={b.status} size="lg" />
                  </div>
                  <p className="mt-2 text-lg font-bold">{contractorName(refs, b.contractorId)}</p>
                  <p className="font-semibold text-slate-600 dark:text-slate-300">{b.manholeId}{m ? ` · ${m.address}` : ''} · job on {fmtJobDate(b.jobDate)}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-3xl font-black tabular-nums">{fmtMoney(b.amount)}</p>
                  <Button className="mt-2" variant="primary" onClick={() => review(b.id)} disabled={!isOfficer || busy === b.id}>
                    <Search className="h-5 w-5" aria-hidden /> {busy === b.id ? 'Reviewing…' : b.status === 'PENDING' ? 'Review' : 'Review again'}
                  </Button>
                </div>
              </div>
              {b.reason && (
                <div className={`mt-4 rounded-xl px-4 py-3 text-base font-semibold ${b.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-950 ring-2 ring-emerald-600 dark:bg-emerald-950 dark:text-emerald-100' : 'bg-red-50 text-red-950 ring-2 ring-red-600 dark:bg-red-950 dark:text-red-100'}`}>
                  <p className="text-lg font-black">{b.status === 'APPROVED' ? 'Payment approved' : 'Payment rejected'}</p>
                  <p>{b.reason}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Reviewed {fmtDateTime(b.reviewedAt)}</span>
                    {b.permitId && (
                      <Link to={`/report/${b.permitId}`} className="inline-flex items-center gap-1 font-bold text-sky-800 underline dark:text-sky-300">
                        <FileText className="h-4 w-4" aria-hidden /> Permit {b.permitId}
                      </Link>
                    )}
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
