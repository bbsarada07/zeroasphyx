import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { LiveProvider } from './lib/live';
import { unlockAudio } from './lib/siren';
import { applyTheme, initialTheme } from './lib/theme';
import './index.css';

applyTheme(initialTheme());

// Browsers only allow audio after a user gesture: unlock the siren on the first click anywhere.
window.addEventListener('pointerdown', unlockAudio, { once: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LiveProvider>
        <App />
      </LiveProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
