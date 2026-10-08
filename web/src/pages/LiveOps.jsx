import { useEffect, useRef, useState } from 'react';
import { ArrowDown, CircleCheck, CircleX, Gauge, Hourglass, Play, Radio, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useLive, useNow } from '../lib/live';
import { post } from '../lib/api';
import { denyBeep } from '../lib/siren';
import { GAS, REASON_HEADLINE, calibrationExpired, fmtTime, gasSafe, manholeOf, workerName } from '../lib/format';
import { Button, Card, ErrorNote, Field, selectCls } from '../components/ui';
import PermitCard from '../components/PermitCard';
import BeaconPanel from '../components/BeaconPanel';
import GasTrend from '../components/GasTrend';

function TestForm() {
  const { refs, live, role, serverNow } = useLive();
  const [form, setForm] = useState({ manholeId: 'MH-001', workerId: 'W-01', supervisorId: 'S-01', deviceId: 'PROBE-001' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const job = live?.job;
  const isSupervisor = role === 'Supervisor';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const start = async () => {
    setBusy(true);
    setError(null);
    try { await post('/sessions', form); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const probes = (refs?.devices || []).filter((d) => d.type === 'probe');
  const now = serverNow();
  const probe = probes.find((d) => d.id === form.deviceId);
  const probeExpired = probe && calibrationExpired(probe.calibrationDue, now);
  return (
    <Card title="1 · Pre-entry gas test" icon={ShieldCheck}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Manhole">
          <select className={selectCls} value={form.manholeId} onChange={set('manholeId')}>
            {(refs?.manholes || []).map((m) => <option key={m.id} value={m.id}>{m.id} · {m.depthCm} cm · {m.address.split(',')[0]}</option>)}
          </select>
        </Field>
        <Field label="Worker">
          <select className={selectCls} value={form.workerId} onChange={set('workerId')}>
            {(refs?.workers || []).map((w) => <option key={w.id} value={w.id}>{w.name} ({w.contractorId})</option>)}
          </select>
        </Field>
        <Field label="Supervisor">
          <select className={selectCls} value={form.supervisorId} onChange={set('supervisorId')}>
            {(refs?.supervisors || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Gas probe">
          <select className={selectCls} value={form.deviceId} onChange={set('deviceId')}>
            {probes.map((d) => (
              <option key={d.id} value={d.id}>{d.id}{calibrationExpired(d.calibrationDue, now) ? ' (calibration expired)' : ''}</option>
            ))}
          </select>
        </Field>
      </div>
      {probeExpired && (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-2xl bg-amber-100 px-4 py-3 text-amber-950 ring-2 ring-amber-500 dark:bg-amber-950 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 h-7 w-7 shrink-0" aria-hidden />
          <div>
            <p className="text-lg font-black">{probe.id} calibration expired on {probe.calibrationDue}</p>
            <p className="font-semibold">Any reading from this probe will be DENIED. Choose a calibrated probe, or recalibrate this one before use.</p>
          </div>
        </div>
      )}
      <Button variant="green" size="lg" className="mt-4 w-full" onClick={start} disabled={busy || Boolean(job) || !isSupervisor}>
        <Play className="h-6 w-6" aria-hidden /> {busy ? 'Starting…' : 'Start pre-entry test'}
      </Button>
      {job && <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Close the open job on {job.id} before starting a new test.</p>}
      {!isSupervisor && <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Switch to the Supervisor role to start a test.</p>}
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}

function SessionStatus({ session, waiting }) {
  const { refs, cfg } = useLive();
  const now = useNow(1000);
  if (!session) return null;
  const age = now - Date.parse(session.createdAt);
  const stale = age > (cfg?.sessionMaxAgeMs || 300000);
  return (
    <div className="mb-4 rounded-xl bg-slate-100 px-4 py-3 text-sm dark:bg-slate-800">
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-semibold text-slate-700 dark:text-slate-200">
        <span>Session <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{session.id}</span></span>
        <span>Nonce <span className="font-mono">{session.nonce}</span></span>
        <span>{session.manholeId} · {workerName(refs, session.workerId)} · {session.deviceId}</span>
        <span>Started {fmtTime(session.createdAt)}</span>
      </div>
      {waiting && (
        <p className="mt-2 flex items-center gap-2 text-base font-bold text-sky-900 dark:text-sky-300">
          <Radio className="h-5 w-5 animate-pulse" aria-hidden />
          {stale ? 'Session expired: start a new test.' : `Challenge sent. Press START on the probe and lower it slowly into ${session.manholeId}.`}
        </p>
      )}
    </div>
  );
}

function DescentPanel({ samples, manhole }) {
  const { cfg } = useLive();
  const g = cfg?.gas;
  const depth = manhole?.depthCm || 300;
  const ratio = cfg?.descent?.minDepthRatio || 0.8;
  const need = Math.ceil(depth * ratio);
  const maxD = samples.length ? Math.max(...samples.map((s) => Number(s.d) || 0)) : 0;
  const pct = Math.min(100, (maxD / depth) * 100);
  const reached = maxD >= need;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-base font-bold text-slate-700 dark:text-slate-200">Probe depth{manhole ? ` in ${manhole.id}` : ''}</span>
          <span className="whitespace-nowrap font-mono text-3xl font-black tabular-nums">{maxD}<span className="text-lg text-slate-500 dark:text-slate-400"> / {depth} cm</span></span>
        </div>
        <div className="relative h-10 overflow-hidden rounded-xl bg-slate-200 ring-2 ring-slate-300 dark:bg-slate-800 dark:ring-slate-700" role="progressbar" aria-valuemin={0} aria-valuemax={depth} aria-valuenow={maxD} aria-label="Probe depth">
          <div className={`h-full transition-all duration-300 ${reached ? 'bg-emerald-600' : 'bg-sky-600'}`} style={{ width: `${pct}%` }} />
          <div className="absolute inset-y-0 border-l-4 border-dashed border-slate-900 dark:border-slate-100" style={{ left: `${ratio * 100}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-sm font-semibold text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-1"><ArrowDown className="h-4 w-4" aria-hidden /> {samples.length} sample{samples.length === 1 ? '' : 's'} (need {cfg?.descent?.minSamples || 3}+, rising depth)</span>
          <span className={reached ? 'font-black text-emerald-800 dark:text-emerald-400' : ''}>{reached ? '✓ ' : ''}Proof of descent at {need} cm</span>
        </div>
      </div>

      <GasTrend samples={samples} g={g} depth={depth} />

      <div className="overflow-x-auto">
        <table className="w-full text-left text-base">
          <thead>
            <tr className="border-b-2 border-slate-200 text-sm uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Depth cm</th>
              {GAS.map((x) => <th key={x.key} className="py-2 pr-3">{x.label} <span className="normal-case">{x.unit}</span></th>)}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {samples.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center font-sans font-semibold text-slate-400 dark:text-slate-500">No samples yet</td></tr>
            )}
            {samples.map((s, i) => (
              <tr key={i} className="za-in border-b border-slate-100 dark:border-slate-800">
                <td className="py-1.5 pr-3 text-slate-400 dark:text-slate-500">{i + 1}</td>
                <td className="py-1.5 pr-3 font-bold">{s.d}</td>
                {GAS.map((x) => {
                  const ok = !g || gasSafe(x.key, s[x.key], g);
                  return (
                    <td key={x.key} className={`py-1.5 pr-3 ${ok ? '' : 'bg-red-700 font-black text-white'}`}>
                      {x.fmt(s[x.key])}{ok ? '' : ' ✖'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultPanel({ result, waiting, permitStatus }) {
  if (waiting) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-3xl border-4 border-dashed border-sky-300 bg-sky-50 p-8 text-center dark:border-sky-800 dark:bg-sky-950">
        <Hourglass className="h-16 w-16 animate-pulse text-sky-700 dark:text-sky-300" aria-hidden />
        <p className="text-3xl font-black text-sky-900 sm:text-4xl dark:text-sky-100">Waiting for signed reading…</p>
        <p className="text-lg font-semibold text-sky-900 dark:text-sky-200">No reading, no entry.</p>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-3xl border-4 border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
        <Gauge className="h-14 w-14 text-slate-400 dark:text-slate-500" aria-hidden />
        <p className="text-3xl font-black text-slate-500 dark:text-slate-400">No test running</p>
        <p className="text-lg font-semibold text-slate-500 dark:text-slate-400">Start a pre-entry test to issue a permit.</p>
      </div>
    );
  }
  const granted = result.decision === 'GRANTED';
  // Once the permit is revoked, expired or closed, a giant green GRANTED would mislead: show a neutral note instead.
  if (granted && permitStatus && permitStatus !== 'ACTIVE') {
    return (
      <div className="rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 text-lg font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
        Pre-entry test passed at {fmtTime(result.receivedAt)} (permit {result.permitId}). The permit is now <span className="font-black">{permitStatus}</span>.
      </div>
    );
  }
  const Icon = granted ? CircleCheck : CircleX;
  return (
    <div className={`za-in rounded-3xl p-6 text-white sm:p-8 ${granted ? 'bg-emerald-700' : 'bg-red-700'}`} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-5">
        <Icon className="h-20 w-20 shrink-0 sm:h-28 sm:w-28" strokeWidth={2.5} aria-hidden />
        <div className="min-w-0">
          <p className="text-6xl font-black leading-none tracking-tight sm:text-8xl">{granted ? 'GRANTED' : 'DENIED'}</p>
          <p className="mt-2 text-2xl font-black sm:text-3xl">{REASON_HEADLINE[result.reason] || result.reason}</p>
        </div>
      </div>
      <p className="mt-4 text-xl font-semibold leading-snug">{result.detail}</p>
      <p className="mt-3 break-all font-mono text-sm opacity-90">
        {granted ? `Permit ${result.permitId}` : `Reason code ${result.reason}`} · reading {result.id} · {result.deviceId} · {fmtTime(result.receivedAt)} · via {result.source}
      </p>
    </div>
  );
}

// Beeps when a new DENIED result arrives, but not for a result that was already there when the page opened.
function useDenyBeep(live) {
  const seen = useRef(undefined);
  const resultId = live ? (live.lastResult?.id ?? null) : undefined;
  useEffect(() => {
    if (resultId === undefined) return;
    if (seen.current === undefined) {
      seen.current = resultId;
      return;
    }
    if (resultId && resultId !== seen.current) {
      seen.current = resultId;
      if (live.lastResult.decision === 'DENIED') denyBeep();
    }
  }, [resultId]);
}

export default function LiveOps() {
  const { live, refs, role } = useLive();
  useDenyBeep(live);
  if (!live) return <p className="p-8 text-xl font-semibold text-slate-500 dark:text-slate-400">Connecting to the server…</p>;
  const { session, lastResult, probeProgress, job, lastPermit } = live;

  const resultIsCurrent = lastResult && (!session || Date.parse(lastResult.receivedAt) >= Date.parse(session.createdAt));
  const waiting = session && session.status === 'PENDING' && !resultIsCurrent;
  const progressing = probeProgress && session && probeProgress.sessionId === session.id && !resultIsCurrent;
  const samples = progressing ? probeProgress.samples : resultIsCurrent ? lastResult.samples || [] : [];
  const manhole = manholeOf(refs, resultIsCurrent ? lastResult.manholeId : session?.manholeId) || manholeOf(refs, session?.manholeId);
  const permit = job || lastPermit;

  // On phones the columns dissolve into one list and the verdict moves to the top, where a field supervisor looks first.
  return (
    <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-5 p-4 lg:grid-cols-12">
      <div className="contents lg:block lg:min-w-0 lg:space-y-5 lg:col-span-5">
        <div className="min-w-0"><TestForm /></div>
        <Card className="min-w-0" title="2 · Probe descent (proof of descent)" icon={ArrowDown}>
          <SessionStatus session={session} waiting={waiting} />
          <DescentPanel samples={samples} manhole={manhole} />
        </Card>
      </div>
      <div className="contents lg:block lg:min-w-0 lg:space-y-5 lg:col-span-7">
        <div className="order-first min-w-0 lg:order-none">
          <ResultPanel result={resultIsCurrent ? lastResult : null} waiting={waiting} permitStatus={permit && lastResult && permit.id === lastResult.permitId ? permit.status : null} />
        </div>
        <Card className="min-w-0" title="3 · Entry permit" icon={ShieldCheck}>
          {permit ? <PermitCard key={permit.id} permit={permit} canClose={role === 'Supervisor'} /> : <p className="text-lg font-semibold text-slate-500 dark:text-slate-400">No permit issued yet.</p>}
        </Card>
        <Card className="min-w-0" title="4 · Worker beacon (live)" icon={Radio}>
          <BeaconPanel />
        </Card>
      </div>
    </div>
  );
}
