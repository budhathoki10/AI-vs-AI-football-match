/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = `127.0.0.1:${process.env.API_PORT ?? 8787}`;
// The server only accepts requests that come from this app's own origin, so the dev proxy forwards the page's host
// (a reverse proxy in production should do the same with X-Forwarded-Host).
const forwardHost = (p: { on: (e: string, f: (pr: { setHeader: (k: string, v: string) => void }, req: { headers: { host?: string } }) => void) => void }, ev: string) =>
  p.on(ev, (pr, req) => { if (req.headers.host) pr.setHeader('x-forwarded-host', req.headers.host); });

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: '127.0.0.1', proxy: {
    '/api': { target: `http://${api}`, configure: (p) => forwardHost(p as never, 'proxyReq') },
    '/ws': { target: `ws://${api}`, ws: true, configure: (p) => forwardHost(p as never, 'proxyReqWs') },
  } },
  build: { chunkSizeWarningLimit: 1600 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
