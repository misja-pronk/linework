// Puts the web component where the site serves it (public/carto/). Only the interactive diagrams
// need it; the static ones are plain SVG in the page.
import fs from 'node:fs';

const from = new URL('../../../packages/embed/dist/', import.meta.url);
const to = new URL('./public/carto/', import.meta.url);
if (!fs.existsSync(new URL('carto-diagram.js', from))) throw new Error('Build the component first: pnpm --filter @cartography/embed build');
fs.mkdirSync(to, { recursive: true });
// The element, the engine and the faces of the looks that are not the default; not the one-file build.
for (const name of fs.readdirSync(from).filter((n) => /^carto-(diagram|engine|font-[a-z-]+)\.js$/.test(n))) fs.copyFileSync(new URL(name, from), new URL(name, to));
