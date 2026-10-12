import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// This micro-frontend is built into one file, remoteEntry.js, which the shell loads at run time.
// "npm run standalone" runs it on its own with hot reload, using index.html.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // A library build does not replace this by itself, and React needs it.
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  build: {
    lib: { entry: 'src/remote.jsx', formats: ['es'], fileName: () => 'remoteEntry.js' },
  },
  server: { host: true, port: 5172, strictPort: true, proxy: { '/api': process.env.GATEWAY_URL || 'http://localhost:8080' } },
  preview: { host: true, port: 5172, strictPort: true, cors: true },
}));
