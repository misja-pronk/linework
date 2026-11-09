// Two versions of one diagram in, the diff out: as data, and as pictures on request.
import { render, type RenderOptions, type RenderResult } from '@cartography/engine';
import type { Diagnostic } from '@cartography/core';
import { diffGraphs, type GraphDiff } from './structure.ts';
import { drawDiff, sideBySide, type Drawing, type OverlayOptions, type Picture } from './overlay.ts';

export interface CompareOptions {
  /** How to read what the older version refers to (includes, pins): its own loader and sidecar. */
  before?: RenderOptions;
  after?: RenderOptions;
  /** One of the diagram's views; without it the diagram as written. */
  view?: string;
  /**
   * Lay the newer drawing out from scratch, as `carto render` would. By default it is drawn knowing the
   * older one, so what both have stays where it was and the picture shows the change, not a reshuffle.
   */
  fresh?: boolean;
}

export interface Comparison {
  diff: GraphDiff;
  before?: RenderResult;
  after?: RenderResult;
  /** Problems in the newer version (the one being proposed). */
  diagnostics: Diagnostic[];
  /** The newer version has errors: there may be no picture. */
  failed: boolean;
  /** The marked-up drawing; undefined when neither version could be drawn. */
  picture(opts?: OverlayOptions): Picture | undefined;
  sideBySide(opts?: OverlayOptions): Picture | undefined;
}

function drawing(r: RenderResult | undefined): Drawing | undefined {
  if (!r?.svg || !r.graph || !r.placed || !r.theme || !r.origin || r.width === undefined || r.height === undefined) return undefined;
  return { svg: r.svg, width: r.width, height: r.height, origin: r.origin, graph: r.graph, placed: r.placed, theme: r.theme };
}

/** `before` or `after` undefined: the file did not exist then (a new diagram), or is gone now. */
export async function compare(before: string | undefined, after: string | undefined, opts: CompareOptions = {}): Promise<Comparison> {
  const view = opts.view ? { view: opts.view } : {};
  const old = before === undefined ? undefined : await render(before, { fonts: 'none', ...opts.before, ...view });
  // A view the older version did not have yet is a new drawing, not an error.
  const was = drawing(old);
  const now =
    after === undefined
      ? undefined
      : await render(after, { fonts: 'none', ...opts.after, ...view, ...(!opts.fresh && was?.placed.memory ? { previous: was.placed.memory } : {}) });
  const is = drawing(now);
  const diff = diffGraphs(was?.graph, is?.graph);
  const diagnostics = now?.diagnostics ?? [];
  return {
    diff,
    ...(old ? { before: old } : {}),
    ...(now ? { after: now } : {}),
    diagnostics,
    failed: diagnostics.some((d) => d.severity === 'error'),
    picture: (o) => (was || is ? drawDiff(was, is, diff, o) : undefined),
    sideBySide: (o) => (was || is ? sideBySide(was, is, diff, o) : undefined),
  };
}
