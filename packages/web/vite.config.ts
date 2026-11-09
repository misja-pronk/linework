import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Static app with relative paths, so it runs from any folder or file server.
  base: './',
  server: { port: 5178, fs: { allow: ['../..'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
