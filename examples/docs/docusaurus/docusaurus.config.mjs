// From the local build; once published: import cartography from '@cartography/docs-plugins/remark'.
import cartography from '../../../packages/docs-plugins/dist/remark.js';

export default {
  title: 'Cartography in Docusaurus',
  url: 'http://localhost',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  // Only for diagrams marked interactive: the component, a few kB until one scrolls into view.
  scripts: [{ src: '/carto/carto-diagram.js', type: 'module' }],
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          // Before Docusaurus's own plugins: those would take the .yaml image for a file to bundle.
          beforeDefaultRemarkPlugins: [[cartography, { description: true }]],
        },
        blog: false,
      },
    ],
  ],
};
