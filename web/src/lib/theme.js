const KEY = 'za-theme';

export function initialTheme() {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'dark' || t === 'light') return t;
  } catch { /* storage blocked */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function saveTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* storage blocked */ }
}
