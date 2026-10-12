import { BrainCircuit } from 'lucide-react';

const STYLE = {
  SAFE: 'bg-emerald-100 text-emerald-950 ring-emerald-600 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-500',
  CAUTION: 'bg-amber-100 text-amber-950 ring-amber-500 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-400',
  DANGER: 'bg-red-700 text-white ring-red-900 motion-safe:animate-pulse dark:bg-red-600 dark:ring-red-300',
};
const SIZE = { sm: 'px-2.5 py-0.5 text-sm gap-1.5', md: 'px-3.5 py-1.5 text-base gap-2', lg: 'px-4 py-2 text-xl gap-2' };
const ICON = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' };

// "Risk 47 · CAUTION · safe to ~180 cm"
export default function RiskBadge({ score, level, worstGas, predictedSafeDepth, size = 'md' }) {
  if (score === null || score === undefined || !STYLE[level]) return null;
  const depth = predictedSafeDepth !== null && predictedSafeDepth !== undefined ? ` · safe to ~${predictedSafeDepth} cm` : '';
  const text = `Risk ${score} · ${level}${depth}`;
  const factor = worstGas ? `, main factor ${worstGas.toUpperCase()}` : '';
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-black tabular-nums ring-2 ${STYLE[level]} ${SIZE[size]}`}
      title={`AI risk score ${score} of 100${factor}`}
      aria-label={`AI ${text}${factor}`}
    >
      <BrainCircuit className={ICON[size]} aria-hidden />
      {text}
    </span>
  );
}
