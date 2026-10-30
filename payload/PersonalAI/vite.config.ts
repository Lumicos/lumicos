import react from '@vitejs/plugin-react';
import { ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import { sourceBuildId } from './server/util/buildInfo.mjs';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const servicePort = env.PERSONALAI_PORT || '8787';

  // If the local service is not running, answer with a clear JSON error instead of a proxy crash page.
  const offline: ProxyOptions['configure'] = (proxy) =>
    proxy.on('error', (_err, _req, res) => {
      if (!(res instanceof ServerResponse)) return;
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'OFFLINE', message: 'The PersonalAI local service is not running. Start it with start-personalai.bat (or npm run service).' } }));
    });

  const proxy: Record<string, ProxyOptions> = {
    // PersonalAI local service (memory, workspace, tools). Same origin for the browser: no CORS.
    '/api': { target: `http://127.0.0.1:${servicePort}`, changeOrigin: true, configure: offline },
    // Optional: set the llama-server URL in Settings to "/llama" to avoid CORS entirely.
    '/llama': {
      target: env.LLAMA_PROXY_TARGET || 'http://127.0.0.1:8080',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/llama/, ''),
    },
  };

  return {
    plugins: [react()],
    // Same id the backend reports in /api/health; the page warns when they differ.
    define: { __LUMICOS_SRC_BUILD__: JSON.stringify(sourceBuildId(process.cwd())) },
    // The desktop workspace contains archived HTML/browser profiles under tmp.
    // Only the application entry participates in dependency discovery.
    optimizeDeps: { entries: ['index.html'] },
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy,
      // Runtime assets are written/locked by the service and Windows cannot
      // always attach an FSWatcher to them (notably VRM files). They are not
      // source inputs, so watching them can only cause spurious reloads or an
      // unhandled EBUSY that terminates the UI server.
      watch: { ignored: ['**/.runtime/**', '**/data/**', '**/logs/**', '**/backups/**'] },
    },
    preview: { host: '127.0.0.1', port: 4173, proxy },
    // Local desktop app: one bundle is fine (markdown + syntax highlighting are most of it).
    build: { chunkSizeWarningLimit: 1200 },
  };
});
