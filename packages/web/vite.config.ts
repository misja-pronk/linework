import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** The dev server runs an inline React Refresh preamble and an HMR socket: the CSP in index.html is for the built app. */
const devWithoutCsp: Plugin = {
  name: 'dev-without-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
};

export default defineConfig({
  plugins: [react(), devWithoutCsp],
  // Static app with relative paths, so it runs from any folder or file server.
  base: './',
  server: { port: 5178, fs: { allow: ['../..'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
