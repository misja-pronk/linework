// The tree engine: nested packing (a capability map) and a tidy tree (an org chart), both fitted to
// a 16:9 slide, plus a square router for the few lines a tree does not draw itself. No Graphviz and
// no chance in it: the same input gives the same drawing, and the arrangement drawn before is kept
// unless another is clearly better.
//
//   pack(roots, options)       boxes inside boxes, equal widths per level, rows wrapped to the slide
//   tidy(roots, options)       a tidy tree with square connectors; lists and wrapped rows for big trees
//   route(boxes, from, to)     a square line around boxes
export * from './fit.ts';
export * from './pack.ts';
export * from './tidy.ts';
export * from './route.ts';
