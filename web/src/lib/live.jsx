import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from './api';

const LiveCtx = createContext(null);

export const ROLES = ['Supervisor', 'Municipal Officer', 'Public'];

function readRole() {
  try {
    const r = localStorage.getItem('za-role');
    return ROLES.includes(r) ? r : 'Supervisor';
  } catch {
    return 'Supervisor';
  }
}

export function LiveProvider({ children }) {
  const [live, setLive] = useState(null);
  const [refs, setRefs] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [socketUp, setSocketUp] = useState(false);
  const [role, setRoleState] = useState(readRole);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const offset = useRef(0);

  useEffect(() => {
    const socket = io({ path: '/socket.io' }); // relative: same origin
    socket.on('connect', () => setSocketUp(true));
    socket.on('disconnect', () => setSocketUp(false));
    socket.on('live', (state) => {
      offset.current = state.serverTime - Date.now();
      setLive(state);
    });
    return () => socket.close();
  }, []);

  useEffect(() => {
    api('/refs').then(setRefs).catch(() => {});
    api('/config').then(setCfg).catch(() => {});
  }, []);

  const setRole = useCallback((r) => {
    setRoleState(r);
    try { localStorage.setItem('za-role', r); } catch { /* ignore */ }
  }, []);

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  return (
    <LiveCtx.Provider value={{ live, refs, cfg, socketUp, role, setRole, serverNow, drawerOpen, setDrawerOpen }}>
      {children}
    </LiveCtx.Provider>
  );
}

export const useLive = () => useContext(LiveCtx);

// Re-renders every `ms` and returns the server-aligned clock.
export function useNow(ms = 500) {
  const { serverNow } = useLive();
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms, serverNow]);
  return now;
}

// Fetches `path` and refetches whenever the server's data version changes.
export function useApiData(path) {
  const { live } = useLive();
  const version = live?.dataVersion;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    api(path)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [path, version, tick]);
  return { data, error, reload: () => setTick((x) => x + 1) };
}
