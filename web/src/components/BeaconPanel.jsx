import { Activity, CircleCheck, CircleX, PersonStanding, Wifi, WifiOff } from 'lucide-react';
import { useLive, useNow } from '../lib/live';
import { GAS, ago, gasLimitText, gasSafe } from '../lib/format';

function Tile({ ok, warn, icon: Icon, label, value, unit, sub, word }) {
  const cls = ok
    ? 'bg-emerald-50 ring-emerald-600 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100'
    : warn
      ? 'bg-amber-100 ring-amber-500 text-amber-950 dark:bg-amber-950 dark:text-amber-100'
      : 'bg-red-700 ring-red-800 text-white';
  return (
    <div className={`min-w-0 rounded-2xl p-4 ring-2 ${cls}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <span className="text-lg font-black">{label}</span>
        <span className="inline-flex items-center gap-1 text-sm font-black">
          <Icon className="h-5 w-5" aria-hidden /> {ok ? 'SAFE' : warn ? 'CHECK' : 'DANGER'}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-black tabular-nums leading-none ${word ? 'text-3xl sm:text-5xl' : 'text-5xl'}`}>{value}</span>
        {unit && <span className="text-base font-bold">{unit}</span>}
      </div>
      {sub && <p className="mt-1 text-xs font-semibold opacity-80">{sub}</p>}
    </div>
  );
}

export default function BeaconPanel() {
  const { live, cfg } = useLive();
  const now = useNow(1000);
  const t = live?.telemetry;
  const job = live?.job;
  const g = cfg?.gas;
  if (!t || !g) {
    return <p className="text-lg font-semibold text-slate-500 dark:text-slate-400">No beacon data yet. The beacon reports every 2 s once a job starts.</p>;
  }
  const linked = job && t.permitId === job.id;
  const mon = job?.monitor;
  const stillMs = mon?.stillSince ? now - mon.stillSince : null;
  const stillLimit = cfg.stillTimeoutMs;
  const lastAt = linked && mon?.lastTelemetryAt ? mon.lastTelemetryAt : Date.parse(t.ts);
  const silentMs = now - lastAt;
  const signalLost = Boolean(mon?.signalLost);

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
        {t.deviceId} · {linked ? `linked to ${job.id}` : t.permitId ? `permit ${t.permitId} (no open job)` : 'not linked to a permit'} · updated {ago(now - Date.parse(t.ts))}
      </p>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {GAS.map((x) => {
          const ok = gasSafe(x.key, t[x.key], g);
          return (
            <Tile key={x.key} ok={ok} icon={ok ? CircleCheck : CircleX} label={x.label} value={x.fmt(t[x.key]) ?? '—'} unit={x.unit} sub={gasLimitText(x.key, g)} />
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {t.moving ? (
          <Tile ok word icon={Activity} label="Movement" value="Moving" />
        ) : (
          <Tile
            ok={false}
            warn={stillMs === null || stillMs < stillLimit}
            icon={PersonStanding}
            label="Movement"
            value="STILL"
            word
            sub={stillMs !== null ? `no movement for ${Math.round(stillMs / 1000)} s (alarm at ${Math.round(stillLimit / 1000)} s)` : undefined}
          />
        )}
        {signalLost ? (
          <Tile ok={false} icon={WifiOff} word label="Signal" value="LOST" sub={`silent ${Math.round(silentMs / 1000)} s`} />
        ) : (
          <Tile ok={silentMs < 5000} warn word icon={Wifi} label="Signal" value={silentMs < 5000 ? 'OK' : 'Late'} sub={`last packet ${ago(silentMs)}`} />
        )}
      </div>
    </div>
  );
}
