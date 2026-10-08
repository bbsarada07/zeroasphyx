import { NavLink, useNavigate } from 'react-router-dom';
import { FlaskConical, Moon, ShieldCheck, Sun, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { ROLES, useLive } from '../lib/live';
import { post } from '../lib/api';

export const NAV = {
  Supervisor: [
    ['/', 'Live Operations'],
    ['/audit', 'Audit Log'],
    ['/scoreboard', 'Scoreboard'],
  ],
  'Municipal Officer': [
    ['/payments', 'Payments'],
    ['/', 'Live Operations'],
    ['/audit', 'Audit Log'],
    ['/scoreboard', 'Scoreboard'],
  ],
  Public: [['/verify', 'Verify a permit']],
};

export function SourceToggle({ large = false }) {
  const { live } = useLive();
  const [busy, setBusy] = useState(false);
  const mode = live?.mode;
  const set = async (m) => {
    if (m === mode) return;
    setBusy(true);
    try { await post('/mode', { mode: m }); } finally { setBusy(false); }
  };
  const pad = large ? 'px-4 py-2.5 text-base' : 'px-3 py-1.5 text-sm';
  const btn = (m, label) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => set(m)}
      aria-pressed={mode === m}
      className={`${pad} font-bold transition ${mode === m ? (m === 'LIVE' ? 'bg-sky-500 text-slate-950' : 'bg-amber-400 text-slate-950') : 'text-slate-300 hover:bg-white/10'}`}
    >
      {label}
    </button>
  );
  return (
    <div className={`inline-flex overflow-hidden rounded-xl border-2 ${large ? 'border-slate-300 bg-slate-800' : 'border-slate-600'}`} role="group" aria-label="Data source">
      {btn('LIVE', 'LIVE (Wokwi)')}
      {btn('SIM', 'SIM')}
    </div>
  );
}

export function MqttDot() {
  const { live, socketUp } = useLive();
  const ok = socketUp && live?.mqtt?.connected;
  const label = !socketUp ? 'Server offline' : live?.mqtt?.enabled === false ? 'MQTT off' : ok ? 'MQTT connected' : 'MQTT connecting…';
  const Icon = ok ? Wifi : WifiOff;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${ok ? 'text-emerald-300' : 'text-amber-300'}`} title={live?.mqtt?.broker}>
      <Icon className="h-4 w-4" aria-hidden /> {label}
    </span>
  );
}

export default function Header({ compact = false }) {
  const { role, setRole, setDrawerOpen, theme, toggleTheme } = useLive();
  const dark = theme === 'dark';
  const ThemeIcon = dark ? Sun : Moon;
  const navigate = useNavigate();

  const changeRole = (r) => {
    setRole(r);
    navigate(NAV[r][0][0]);
  };

  return (
    <header className="bg-slate-950 text-white print:hidden">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <NavLink to={NAV[role][0][0]} className="flex items-center gap-2.5">
          <ShieldCheck className="h-9 w-9 text-emerald-400" aria-hidden />
          <div className="leading-tight">
            <div className="text-xl font-black tracking-tight">ZeroAsphyx</div>
            <div className="text-xs font-semibold text-slate-400">No Reading, No Entry, No Payment</div>
          </div>
        </NavLink>

        {!compact && (
          <nav className="flex flex-wrap gap-1" aria-label="Main">
            {NAV[role].map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-bold ${isActive ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {!compact && (
            <>
              <MqttDot />
              <SourceToggle />
            </>
          )}
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <span className="hidden sm:inline">Role</span>
            <select
              value={role}
              onChange={(e) => changeRole(e.target.value)}
              className="rounded-lg border-2 border-slate-600 bg-slate-900 px-2 py-1.5 text-sm font-bold text-white"
            >
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={dark ? 'Light theme' : 'Dark theme'}
            className="rounded-lg border-2 border-slate-600 p-1.5 text-slate-200 hover:bg-white/10"
          >
            <ThemeIcon className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-bold text-slate-950 hover:bg-amber-300"
          >
            <FlaskConical className="h-4 w-4" aria-hidden /> Simulator
          </button>
        </div>
      </div>
    </header>
  );
}
