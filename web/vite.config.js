import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const target = 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // listen on IPv4 and IPv6 so both localhost and 127.0.0.1 work
    port: 5173,
    strictPort: true,
    proxy: {
      // changeOrigin: false keeps the browser's Host header, so QR codes use the address the dashboard was opened from
      '/api': { target, changeOrigin: false },
      '/socket.io': { target, ws: true, changeOrigin: false },
    },
  },
});
