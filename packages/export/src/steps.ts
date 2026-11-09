// A diagram with steps becomes one slide or page per step: the same drawing in the same place,
// only what shows and what stands out changes, so clicking through (or Morph) reads as one build-up.
import type { StepView } from '@cartography/render';
import type { Drawing } from './pptx.ts';

export interface Page {
  drawing: Drawing;
  /** The step this page shows; without it the whole drawing at full strength. */
  view?: StepView;
}

/**
 * The pages of a deck. A drawing with written steps gets one per step; steps nobody wrote (a
 * dynamic view's numbered lines, a sequence's messages) only when `all` asks for them, and
 * `all: false` keeps every drawing on one page.
 */
export function pages(drawings: Drawing[], all?: boolean): Page[] {
  return drawings.flatMap((drawing): Page[] => {
    const states = drawing.steps;
    if (!states?.length) return [{ drawing }];
    if (drawing.step) return [{ drawing, view: { index: Math.min(states.length, Math.max(1, drawing.step)) - 1, states } }];
    if (!(all ?? !drawing.stepsImplied)) return [{ drawing }];
    return states.map((_, index) => ({ drawing, view: { index, states } }));
  });
}
