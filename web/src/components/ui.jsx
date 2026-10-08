import { Ban, CircleCheck, CircleHelp, CircleX, Clock, TriangleAlert } from 'lucide-react';

export function Card({ title, icon: Icon, right, children, className = '' }) {
  return (
    <section className={`rounded-2xl border-2 border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b-2 border-slate-100 px-5 py-3 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {Icon && <Icon className="h-5 w-5 text-slate-500 dark:text-slate-400" aria-hidden />}
            {title}
          </h2>
          {right}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }) {
  const variants = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-300 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white dark:disabled:bg-slate-700 dark:disabled:text-slate-400',
    green: 'bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400',
    red: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400',
    outline: 'border-2 border-slate-300 bg-white text-slate-900 hover:bg-slate-50 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
    redOutline: 'border-2 border-red-300 bg-white text-red-800 hover:bg-red-50 disabled:text-slate-400 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950',
  };
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-base', lg: 'px-6 py-4 text-lg' };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

// Status colours are always paired with an icon and a word.
const STATUS = {
  GRANTED: ['bg-emerald-700 text-white', CircleCheck],
  VALID: ['bg-emerald-700 text-white', CircleCheck],
  ACTIVE: ['bg-emerald-700 text-white', CircleCheck],
  APPROVED: ['bg-emerald-700 text-white', CircleCheck],
  CLOSED: ['bg-slate-700 text-white', CircleCheck],
  DENIED: ['bg-red-700 text-white', CircleX],
  REJECTED: ['bg-red-700 text-white', CircleX],
  REVOKED: ['bg-red-700 text-white', Ban],
  EXPIRED: ['bg-amber-500 text-slate-950', Clock],
  PENDING: ['bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100', Clock],
  NOT_FOUND: ['bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100', CircleHelp],
  WARNING: ['bg-amber-500 text-slate-950', TriangleAlert],
};

export function StatusPill({ status, label, size = 'md' }) {
  const [cls, Icon] = STATUS[status] || STATUS.PENDING;
  const sizes = { sm: 'px-2 py-0.5 text-xs gap-1', md: 'px-3 py-1 text-sm gap-1.5', lg: 'px-4 py-2 text-xl gap-2' };
  const iconSize = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-6 w-6' };
  return (
    <span className={`inline-flex items-center rounded-full font-bold tracking-wide ${cls} ${sizes[size]}`}>
      <Icon className={iconSize[size]} aria-hidden />
      {label || String(status).replace('_', ' ')}
    </span>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

export const selectCls = 'w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-2.5 text-base font-medium text-slate-900 focus:border-sky-600 focus:outline-none disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800';

export function KV({ k, v, mono }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{k}</dt>
      <dd className={`text-base font-semibold text-slate-900 dark:text-slate-100 ${mono ? 'font-mono text-sm break-all' : ''}`}>{v ?? '—'}</dd>
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">
      <CircleX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {children}
    </p>
  );
}
