import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Lock, NotebookPen } from 'lucide-react';
import { useApiData, useLive, useNow } from '../lib/live';
import { api, post } from '../lib/api';
import { contractorName, fmtCountdown, fmtTime, manholeOf, relTime, supervisorName, workerName } from '../lib/format';
import { Button, ErrorNote, KV, StatusPill } from './ui';

export function PermitQR({ permitId, size = 'h-36 w-36' }) {
  const [qr, setQr] = useState(null);
  useEffect(() => {
    let alive = true;
    api(`/permits/${permitId}/qr`).then((d) => alive && setQr(d)).catch(() => {});
    return () => { alive = false; };
  }, [permitId]);
  if (!qr) return <div className={`${size} animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800`} />;
  return (
    <a href={qr.url} target="_blank" rel="noreferrer" className="block text-center">
      <img src={qr.dataUrl} alt={`QR code to verify permit ${permitId}`} className={`${size} rounded-xl border-2 border-slate-200 dark:border-slate-700`} />
      <span className="mt-1 block text-xs font-semibold text-sky-800 underline dark:text-sky-300">Scan to verify</span>
    </a>
  );
}

function PermitNotes({ permitId }) {
  const { role, cfg } = useLive();
  const now = useNow(15000);
  const { data: notes, error: loadError } = useApiData(`/permits/${encodeURIComponent(permitId)}/notes`);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const max = cfg?.noteMaxLength || 1000;
  const canWrite = role !== 'Public';

  const save = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await post(`/permits/${encodeURIComponent(permitId)}/notes`, { text, author: role });
      setText('');
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const list = [...(notes || [])].reverse();
  return (
    <section aria-labelledby={`notes-${permitId}`} className="rounded-2xl border-2 border-slate-200 p-4 dark:border-slate-800">
      <h3 id={`notes-${permitId}`} className="flex items-center gap-2 text-base font-black text-slate-900 dark:text-slate-100">
        <NotebookPen className="h-5 w-5 text-slate-500 dark:text-slate-400" aria-hidden /> Job notes
      </h3>
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Saved to the tamper-evident audit log. Notes cannot be edited or deleted.</p>
      {canWrite && (
        <form onSubmit={save} className="mt-3 space-y-2">
          <label className="sr-only" htmlFor={`note-text-${permitId}`}>New note</label>
          <textarea
            id={`note-text-${permitId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={max}
            rows={2}
            placeholder="What happened? e.g. Worker reported a strong smell at 2 m and came out."
            className="w-full resize-y rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-sky-600 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{text.length} / {max} · as {role}</span>
            <Button type="submit" size="sm" disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Add note'}</Button>
          </div>
        </form>
      )}
      <ErrorNote>{error || loadError}</ErrorNote>
      {list.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {list.map((n) => (
            <li key={n.seq} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
              <p className="whitespace-pre-wrap break-words font-semibold text-slate-900 dark:text-slate-100">{n.text}</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {n.author} · {fmtTime(n.ts)} ({relTime(now - Date.parse(n.ts))}) · audit #{n.seq}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        notes && <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">No notes yet.</p>
      )}
    </section>
  );
}

export default function PermitCard({ permit, canClose }) {
  const { refs, cfg } = useLive();
  const now = useNow(250);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState(null);
  const manhole = manholeOf(refs, permit.manholeId);
  const remaining = Date.parse(permit.expiresAt) - now;
  const status = permit.status === 'ACTIVE' && remaining <= 0 ? 'EXPIRED' : permit.status;

  const close = async () => {
    setClosing(true);
    setError(null);
    try { await post(`/permits/${permit.id}/close`); } catch (e) { setError(e.message); } finally { setClosing(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{permit.jobOpen ? 'Current permit' : 'Last permit'}</p>
          <p className="font-mono text-2xl font-black text-slate-900 dark:text-slate-100">{permit.id}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={status} size="lg" />
            <span className="text-sm font-bold text-slate-600 dark:text-slate-300">{permit.jobOpen ? 'Job open' : `Job closed ${fmtTime(permit.closedAt)}`}</span>
          </div>
        </div>
        <PermitQR permitId={permit.id} />
      </div>

      {permit.status === 'ACTIVE' && remaining > 0 && (
        <div className="rounded-2xl bg-emerald-50 px-5 py-4 ring-2 ring-emerald-600 dark:bg-emerald-950">
          <p className="text-sm font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-200">Valid for</p>
          <p className="font-mono text-6xl font-black tabular-nums leading-none text-emerald-800 sm:text-7xl dark:text-emerald-300">{fmtCountdown(remaining)}</p>
          <p className="mt-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            Demo validity {Math.round((cfg?.permitValidityMs || 180000) / 60000)} min · production would be {cfg?.productionValidityMin || 30} min
          </p>
        </div>
      )}
      {status === 'EXPIRED' && permit.jobOpen && (
        <div className="rounded-2xl bg-amber-100 px-5 py-4 text-xl font-black text-amber-950 ring-2 ring-amber-500 dark:bg-amber-950 dark:text-amber-100">Permit expired: re-test required</div>
      )}
      {permit.status === 'REVOKED' && (
        <div className="rounded-2xl bg-red-50 px-5 py-4 ring-2 ring-red-600 dark:bg-red-950">
          <p className="text-xl font-black text-red-800 dark:text-red-300">REVOKED at {fmtTime(permit.revokedAt)}</p>
          <p className="font-semibold text-red-900 dark:text-red-200">{permit.revokeReason}</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KV k="Manhole" v={`${permit.manholeId}${manhole ? ` · ${manhole.depthCm} cm` : ''}`} />
        <KV k="Worker" v={workerName(refs, permit.workerId)} />
        <KV k="Contractor" v={contractorName(refs, permit.contractorId)} />
        <KV k="Supervisor" v={supervisorName(refs, permit.supervisorId)} />
        <KV k="Issued" v={`${fmtTime(permit.issuedAt)} (${relTime(now - Date.parse(permit.issuedAt))})`} />
        <KV k="Expires" v={fmtTime(permit.expiresAt)} />
      </dl>

      <div className="flex flex-wrap gap-3">
        {permit.jobOpen && (
          <Button variant="primary" size="lg" onClick={close} disabled={!canClose || closing} title={canClose ? undefined : 'Only the Supervisor can close the job'}>
            <Lock className="h-5 w-5" aria-hidden /> {closing ? 'Closing…' : 'Close job'}
          </Button>
        )}
        <Link to={`/report/${permit.id}`} className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-300 px-4 py-2.5 font-semibold hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
          <FileText className="h-5 w-5" aria-hidden /> Evidence report
        </Link>
      </div>
      {!canClose && permit.jobOpen && <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Switch to the Supervisor role to close the job.</p>}
      <ErrorNote>{error}</ErrorNote>

      <PermitNotes permitId={permit.id} />
    </div>
  );
}
