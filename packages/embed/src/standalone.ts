// Everything in one file, for a page that has to work on its own (carto embed): no second request.
import { define, setEngine } from './element.ts';
import * as engine from './engine.ts';

setEngine(() => Promise.resolve(engine));
define();
