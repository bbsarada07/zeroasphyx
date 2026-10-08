import { useState } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { GAS, gasSafe } from '../lib/format';

const W = 260;
const H = 116;
const M = { l: 34, r: 10, t: 10, b: 22 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

const num = (raw) => (raw === null || raw === undefined || raw === '' ? NaN : Number(raw));
const limitLabel = (key, v) => (key === 'o2' ? (v / 10).toFixed(1) : String(v));

// Each gas gets its own scale (different units and limits), always wide enough to show the limit.
function scaleFor(key, vals, g) {
  if (key === 'o2') {
    const y0 = Math.min(g.o2Min - 15, ...vals.map((v) => v - 5));
    const y1 = Math.max(g.o2Max + 15, ...vals.map((v) => v + 5));
    return { y0, y1, limits: [g.o2Min, g.o2Max], danger: [[y0, g.o2Min], [g.o2Max, y1]] };
  }
  const limit = g[`${key}Max`];
  const y1 = Math.max(limit * 1.5, ...vals.map((v) => v * 1.1));
  return { y0: 0, y1, limits: [limit], danger: [[limit, y1]] };
}

function GasChart({ gas, samples, g, xMax }) {
  const [hover, setHover] = useState(null);
  const pts = samples.map((s) => ({ d: Number(s.d) || 0, raw: s[gas.key], v: num(s[gas.key]) }));
  const finite = pts.filter((p) => Number.isFinite(p.v));
  const { y0, y1, limits, danger } = scaleFor(gas.key, finite.map((p) => p.v), g);
  const x = (d) => M.l + (Math.min(Math.max(d, 0), xMax) / xMax) * PW;
  const y = (v) => M.t + PH - ((Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * PH;
  const path = finite.map((p, k) => `${k ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const unsafe = pts.filter((p) => !gasSafe(gas.key, p.v, g));
  const ok = unsafe.length === 0;
  const last = pts[pts.length - 1];
  const h = hover !== null ? pts[hover] : null;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(x(p.d) - sx) < Math.abs(x(pts[best].d) - sx)) best = i; });
    setHover(best);
  };

  const summary = `${gas.label} by depth: latest ${gas.fmt(last.raw) ?? '—'} ${gas.unit}, ${ok ? 'all samples safe' : `${unsafe.length} unsafe sample${unsafe.length === 1 ? '' : 's'}`}`;
  const StatusIcon = ok ? CircleCheck : CircleX;

  return (
    <div className="min-w-0 rounded-xl border-2 border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <span className="text-base font-black text-slate-900 dark:text-slate-100">
          {gas.label} <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{gas.unit}</span>
        </span>
        <span className={`inline-flex items-center gap-1 text-xs font-black ${ok ? 'text-emerald-800 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
          <StatusIcon className="h-4 w-4" aria-hidden /> {ok ? 'SAFE' : 'DANGER'}
        </span>
      </div>
      <div className="relative">
        {h && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white shadow dark:bg-slate-100 dark:text-slate-950"
            style={{ left: `${Math.min(80, Math.max(20, (x(h.d) / W) * 100))}%` }}
          >
            {h.d} cm · {gas.fmt(h.raw) ?? '—'} {gas.unit}
          </div>
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-none select-none"
          role="img"
          aria-label={summary}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {danger.map(([a, b]) => (
            <rect key={a} x={M.l} y={y(b)} width={PW} height={Math.max(0, y(a) - y(b))} className="fill-red-600/10 dark:fill-red-500/15" />
          ))}
          <line x1={M.l} x2={M.l + PW} y1={M.t + PH} y2={M.t + PH} strokeWidth="1" className="stroke-slate-300 dark:stroke-slate-700" />
          {limits.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={M.l + PW} y1={y(v)} y2={y(v)} strokeWidth="1.5" strokeDasharray="4 3" className="stroke-red-700 dark:stroke-red-400" />
              <text x={M.l - 4} y={y(v) + 3.5} textAnchor="end" fontSize="10" fontWeight="700" className="fill-slate-500 dark:fill-slate-400">{limitLabel(gas.key, v)}</text>
            </g>
          ))}
          <text x={M.l} y={H - 6} fontSize="10" className="fill-slate-500 dark:fill-slate-400">0</text>
          <text x={M.l + PW} y={H - 6} fontSize="10" textAnchor="end" className="fill-slate-500 dark:fill-slate-400">{xMax} cm deep</text>
          {h && <line x1={x(h.d)} x2={x(h.d)} y1={M.t} y2={M.t + PH} strokeWidth="1" strokeDasharray="2 2" className="stroke-slate-400 dark:stroke-slate-500" />}
          <path d={path} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="stroke-slate-700 dark:stroke-slate-300" />
          {pts.map((p, i) => {
            const bad = !gasSafe(gas.key, p.v, g);
            const r = (bad ? 5 : 4) + (hover === i ? 1.5 : 0);
            return (
              <circle
                key={i}
                cx={x(p.d)}
                cy={Number.isFinite(p.v) ? y(p.v) : M.t}
                r={r}
                strokeWidth="2"
                className={`stroke-slate-50 dark:stroke-slate-950 ${bad ? 'fill-red-700 dark:fill-red-500' : 'fill-slate-700 dark:fill-slate-300'}`}
              />
            );
          })}
          <rect x={M.l} y={M.t} width={PW} height={PH} fill="transparent" />
        </svg>
      </div>
    </div>
  );
}

export default function GasTrend({ samples, g, depth }) {
  if (!samples.length || !g) return null;
  const xMax = Math.max(depth, ...samples.map((s) => Number(s.d) || 0));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Gas level by probe depth">
      {GAS.map((gas) => <GasChart key={gas.key} gas={gas} samples={samples} g={g} xMax={xMax} />)}
    </div>
  );
}
