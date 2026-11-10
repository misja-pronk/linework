import { defineConfig } from 'vitepress';
// From the local build; once published: import cartography from '@cartography/docs-plugins/markdown-it'.
import cartography from '../../../../packages/docs-plugins/dist/markdown-it.js';

export default defineConfig({
  title: 'Cartography in VitePress',
  description: 'Diagrams kept as YAML next to the docs',
  // Only for diagrams marked interactive: the component, a few kB until one scrolls into view.
  head: [['script', { type: 'module', src: '/carto/carto-diagram.js' }]],
  markdown: {
    // VitePress compiles pages as Vue templates (vue: true) and marks a dark page with a .dark class.
    config: (md) => md.use(cartography, { vue: true, dark: '.dark', description: true }),
  },
});
