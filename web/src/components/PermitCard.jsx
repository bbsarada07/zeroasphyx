import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Lock } from 'lucide-react';
import { useLive, useNow } from '../lib/live';
import { api, post } from '../lib/api';
import { contractorName, fmtCountdown, fmtTime, manholeOf, supervisorName, workerName } from '../lib/format';
import { Button, ErrorNote, KV, StatusPill } from './ui';

export function PermitQR({ permitId, size = 'h-36 w-36' }) {
  const [qr, setQr] = useState(null);
  useEffect(() => {
    let alive = true;
    api(`/permits/${permitId}/qr`).then((d) => alive && setQr(d)).catch(() => {});
    return () => { alive = false; };
  }, [permitId]);
  if (!qr) return <div className={`${size} animate-pulse rounded-xl bg-slate-100`} />;
  return (
    <a href={qr.url} target="_blank" rel="noreferrer" className="block text-center">
      <img src={qr.dataUrl} alt={`QR code to verify permit ${permitId}`} className={`${size} rounded-xl border-2 border-slate-200`} />
      <span className="mt-1 block text-xs font-semibold text-sky-800 underline">Scan to verify</span>
    </a>
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
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{permit.jobOpen ? 'Current permit' : 'Last permit'}</p>
          <p className="font-mono text-2xl font-black text-slate-900">{permit.id}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={status} size="lg" />
            {permit.jobOpen ? <span className="text-sm font-bold text-slate-600">Job open</span> : <span className="text-sm font-bold text-slate-600">Job closed {fmtTime(permit.closedAt)}</span>}
          </div>
        </div>
        <PermitQR permitId={permit.id} />
      </div>

      {permit.status === 'ACTIVE' && remaining > 0 && (
        <div className="rounded-2xl bg-emerald-50 px-5 py-4 ring-2 ring-emerald-600">
          <p className="text-sm font-bold uppercase tracking-wider text-emerald-900">Valid for</p>
          <p className="font-mono text-7xl font-black tabular-nums leading-none text-emerald-800">{fmtCountdown(remaining)}</p>
          <p className="mt-2 text-sm font-semibold text-emerald-900">
            Demo validity {Math.round((cfg?.permitValidityMs || 180000) / 60000)} min · production would be {cfg?.productionValidityMin || 30} min
          </p>
        </div>
      )}
      {status === 'EXPIRED' && permit.jobOpen && (
        <div className="rounded-2xl bg-amber-100 px-5 py-4 text-xl font-black text-amber-950 ring-2 ring-amber-500">Permit expired: re-test required</div>
      )}
      {permit.status === 'REVOKED' && (
        <div className="rounded-2xl bg-red-50 px-5 py-4 ring-2 ring-red-600">
          <p className="text-xl font-black text-red-800">REVOKED at {fmtTime(permit.revokedAt)}</p>
          <p className="font-semibold text-red-900">{permit.revokeReason}</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KV k="Manhole" v={`${permit.manholeId}${manhole ? ` · ${manhole.depthCm} cm` : ''}`} />
        <KV k="Worker" v={workerName(refs, permit.workerId)} />
        <KV k="Contractor" v={contractorName(refs, permit.contractorId)} />
        <KV k="Supervisor" v={supervisorName(refs, permit.supervisorId)} />
        <KV k="Issued" v={fmtTime(permit.issuedAt)} />
        <KV k="Expires" v={fmtTime(permit.expiresAt)} />
      </dl>

      <div className="flex flex-wrap gap-3">
        {permit.jobOpen && (
          <Button variant="primary" size="lg" onClick={close} disabled={!canClose || closing} title={canClose ? undefined : 'Only the Supervisor can close the job'}>
            <Lock className="h-5 w-5" aria-hidden /> {closing ? 'Closing…' : 'Close job'}
          </Button>
        )}
        <Link to={`/report/${permit.id}`} className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-300 px-4 py-2.5 font-semibold hover:bg-slate-50">
          <FileText className="h-5 w-5" aria-hidden /> Evidence report
        </Link>
      </div>
      {!canClose && permit.jobOpen && <p className="text-sm font-semibold text-slate-500">Switch to the Supervisor role to close the job.</p>}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
