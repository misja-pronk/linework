// Puts the web component where the site serves it (public/carto/). Only the interactive diagrams
// need it; the static ones are plain SVG in the page.
import fs from 'node:fs';

const from = new URL('../../../packages/embed/dist/', import.meta.url);
const to = new URL('./public/carto/', import.meta.url);
if (!fs.existsSync(new URL('carto-diagram.js', from))) throw new Error('Build the component first: pnpm --filter @cartography/embed build');
fs.mkdirSync(to, { recursive: true });
for (const name of ['carto-diagram.js', 'carto-engine.js']) fs.copyFileSync(new URL(name, from), new URL(name, to));
