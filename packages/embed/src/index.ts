// The loader: registers <carto-diagram> and fetches the engine (carto-engine.js, next to this
// file) when the first diagram comes near the viewport.
import { define, setEngine } from './element.ts';

setEngine(() => import('./engine.ts'));
define();

export { CartoDiagram, pageScheme } from './element.ts';
