import { useParams } from 'react-router-dom';
import { Printer, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useApiData } from '../lib/live';
import { GAS, REASON_HEADLINE, fmtDateTime, fmtMoney, fmtTime, summarizeEvent, shortHash } from '../lib/format';
import { Button, ErrorNote, StatusPill } from '../components/ui';
import { PermitQR } from '../components/PermitCard';

function Section({ title, children }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="mb-2 border-b-2 border-slate-900 pb-1 text-lg font-black uppercase tracking-wide dark:border-slate-300">{title}</h2>
      {children}
    </section>
  );
}

const Row = ({ k, v, mono }) => (
  <div className="flex gap-3 py-0.5">
    <dt className="w-36 shrink-0 font-semibold text-slate-500 dark:text-slate-400">{k}</dt>
    <dd className={`font-semibold ${mono ? 'break-all font-mono text-xs' : ''}`}>{v ?? '—'}</dd>
  </div>
);

export default function Report() {
  const { id } = useParams();
  const { data: r, error } = useApiData(`/report/${encodeURIComponent(id)}`);
  if (error) return <div className="mx-auto max-w-4xl p-4"><ErrorNote>{error}</ErrorNote></div>;
  if (!r) return <p className="p-8 text-xl font-semibold text-slate-500 dark:text-slate-400">Loading report…</p>;
  const p = r.permit;

  return (
    <div className="mx-auto max-w-5xl p-4 print:max-w-none print:p-0">
      <div className="mb-4 flex justify-end print:hidden">
        <Button onClick={() => window.print()}><Printer className="h-5 w-5" aria-hidden /> Print / save as PDF</Button>
      </div>
      <article className="space-y-6 rounded-2xl border-2 border-slate-200 bg-white p-6 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">ZeroAsphyx evidence report</p>
            <h1 className="text-3xl font-black">{r.focus.kind === 'incident' ? `Incident ${r.focus.id}` : `Permit ${p.id}`}</h1>
            <p className="font-semibold text-slate-600 dark:text-slate-300">Generated {fmtDateTime(r.generatedAt)} · No Reading, No Entry, No Payment</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <StatusPill status={p.status} size="lg" />
              {r.chain.ok ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-base font-bold text-white"><ShieldCheck className="h-5 w-5" aria-hidden /> Audit chain verified ({r.chain.count} records)</span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full bg-red-700 px-4 py-2 text-base font-bold text-white"><ShieldAlert className="h-5 w-5" aria-hidden /> Audit chain BROKEN at record #{r.chain.brokenAt}</span>
              )}
            </div>
          </div>
          <PermitQR permitId={p.id} size="h-28 w-28" />
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Section title="Permit">
            <dl>
              <Row k="Permit ID" v={p.id} mono />
              <Row k="Status" v={p.status} />
              <Row k="Issued" v={fmtDateTime(p.issuedAt)} />
              <Row k="Valid until" v={fmtDateTime(p.expiresAt)} />
              {p.revokedAt && <Row k="Revoked" v={`${fmtDateTime(p.revokedAt)}: ${p.revokeReason}`} />}
              <Row k="Job closed" v={p.closedAt ? `${fmtDateTime(p.closedAt)} by ${p.closedBy}` : 'still open'} />
              <Row k="Manhole" v={`${r.manhole.id} · ${r.manhole.address}`} />
              <Row k="Registered depth" v={`${r.manhole.depthCm} cm`} />
              <Row k="GPS" v={`${(r.manhole.lat / 1e6).toFixed(6)}, ${(r.manhole.lng / 1e6).toFixed(6)}`} />
            </dl>
          </Section>
          <Section title="People and devices">
            <dl>
              <Row k="Worker" v={`${r.worker?.name} (${r.worker?.id})`} />
              <Row k="Contractor" v={`${r.contractor?.name} (${r.contractor?.id})`} />
              <Row k="Supervisor" v={`${r.supervisor?.name} (${r.supervisor?.id})`} />
              <Row k="Gas probe" v={r.probe ? `${r.probe.id} · calibration due ${r.probe.calibrationDue}` : p.deviceId} />
              <Row k="Worker beacon" v={r.beacon ? `${r.beacon.id} · calibration due ${r.beacon.calibrationDue}` : '—'} />
              <Row k="Test session" v={r.session ? `${r.session.id} · nonce ${r.session.nonce}` : '—'} mono />
            </dl>
          </Section>
        </div>

        <Section title="Pre-entry readings (signed by the probe)">
          {r.readings.map((rd) => (
            <div key={rd.id} className="mb-4 break-inside-avoid">
              <p className="mb-1 flex flex-wrap items-center gap-2 font-semibold">
                <StatusPill status={rd.decision} size="sm" />
                <span>{REASON_HEADLINE[rd.reason] || rd.reason}: {rd.detail}</span>
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">Reading {rd.id} · {fmtDateTime(rd.receivedAt)} · {rd.deviceId} · via {rd.source} · position {rd.lat}, {rd.lng} (µ°)</p>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full text-left font-mono text-xs">
                  <thead><tr className="border-b border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400"><th className="py-1">Depth cm</th>{GAS.map((g) => <th key={g.key}>{g.label} {g.unit}</th>)}</tr></thead>
                  <tbody>
                    {(rd.samples || []).map((s, i) => (
                      <tr key={i} className="border-b border-slate-100 dark:border-slate-800"><td className="py-0.5">{s.d}</td>{GAS.map((g) => <td key={g.key}>{g.fmt(s[g.key])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 break-all font-mono text-xs">
                HMAC-SHA256 {rd.sig} <span className={`font-sans font-bold ${rd.sigValid ? 'text-emerald-800 dark:text-emerald-400' : 'text-red-800 dark:text-red-400'}`}>{rd.sigValid ? '✓ signature valid' : '✖ signature invalid'}</span>
              </p>
            </div>
          ))}
        </Section>

        <Section title="Incidents">
          {r.incidents.length === 0 ? <p className="font-semibold">None recorded.</p> : (
            <ul className="space-y-1">
              {r.incidents.map((i) => (
                <li key={i.id} className={`font-semibold ${r.focus.id === i.id ? 'text-red-800 dark:text-red-400' : ''}`}>
                  {i.id} · {i.cause} · {fmtDateTime(i.createdAt)} · {i.source} · {i.acknowledgedAt ? `acknowledged ${fmtTime(i.acknowledgedAt)}` : 'not acknowledged'}
                  {i.lastReadings && ` · last H₂S ${i.lastReadings.h2s} ppm, CO ${i.lastReadings.co} ppm, CH₄ ${i.lastReadings.ch4} %LEL, O₂ ${(i.lastReadings.o2 / 10).toFixed(1)} %, ${i.lastReadings.moving ? 'moving' : 'still'}`}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Job notes (from the audit log)">
          {r.notes.length === 0 ? <p className="font-semibold">None recorded.</p> : (
            <ul className="space-y-2">
              {r.notes.map((n) => (
                <li key={n.seq} className="break-inside-avoid">
                  <p className="whitespace-pre-wrap break-words font-semibold">{n.text}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">{n.author} · {fmtDateTime(n.ts)} · audit record #{n.seq}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`Beacon telemetry (${r.telemetryCount} readings${r.telemetryCount > r.telemetry.length ? `, last ${r.telemetry.length} shown` : ''})`}>
          {r.telemetry.length === 0 ? <p className="font-semibold">No telemetry recorded.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead><tr className="border-b border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400"><th className="py-1">Time</th>{GAS.map((g) => <th key={g.key}>{g.label}</th>)}<th>Motion</th><th>SOS</th></tr></thead>
                <tbody>
                  {r.telemetry.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-0.5">{fmtTime(t.ts)}</td>{GAS.map((g) => <td key={g.key}>{g.fmt(t[g.key])}</td>)}<td>{t.moving ? 'moving' : 'STILL'}</td><td>{t.sos ? 'YES' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Timeline (from the audit log)">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400"><th className="py-1">#</th><th>Time</th><th>Event</th><th>Details</th><th>Hash</th></tr></thead>
              <tbody>
                {r.events.map((e) => (
                  <tr key={e.seq} className={`border-b border-slate-100 align-top dark:border-slate-800 ${r.chain.brokenAt === e.seq ? 'bg-red-100 dark:bg-red-950' : ''}`}>
                    <td className="py-1 pr-2 font-mono">{e.seq}</td>
                    <td className="whitespace-nowrap pr-2">{fmtDateTime(e.ts)}</td>
                    <td className="pr-2 font-mono font-bold">{e.type}</td>
                    <td className="pr-2">{summarizeEvent(e)}</td>
                    <td className="font-mono" title={e.hash}>{shortHash(e.hash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {r.bills.length > 0 && (
          <Section title="Related bills">
            <ul className="space-y-1">
              {r.bills.map((b) => (
                <li key={b.id} className="font-semibold">{b.id} · {fmtMoney(b.amount)} · {b.status}{b.reason ? `: ${b.reason}` : ''}</li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Chain verification">
          <p className="break-all font-semibold">
            {r.chain.ok
              ? `Verified: all ${r.chain.count} audit records hash-link correctly. Chain head ${r.chain.head}.`
              : `FAILED at record #${r.chain.brokenAt}: ${r.chain.reason}.`}
          </p>
        </Section>
      </article>
    </div>
  );
}
