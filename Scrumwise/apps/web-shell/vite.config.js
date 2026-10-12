import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The shell is the page the browser opens. Requests to /api go to the gateway, so the
// browser only ever talks to one address. The micro-frontends are loaded from the URLs below.
export default defineConfig({
  plugins: [react()],
  define: {
    __REMOTES__: JSON.stringify({
      auth: process.env.AUTH_APP_URL || 'http://localhost:5171/remoteEntry.js',
      work: process.env.WORKSPACE_APP_URL || 'http://localhost:5172/remoteEntry.js',
      chat: process.env.CHAT_APP_URL || 'http://localhost:5173/remoteEntry.js',
    }),
  },
  server: {
    host: true,
    port: 5170,
    strictPort: true,
    proxy: { '/api': { target: process.env.GATEWAY_URL || 'http://localhost:8080', changeOrigin: true } },
  },
});
