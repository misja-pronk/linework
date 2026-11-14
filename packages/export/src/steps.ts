// A diagram with steps becomes one slide or page per step: the same drawing in the same place,
// only what shows and what stands out changes, so clicking through (or Morph) reads as one build-up.
import { fadeState, finalState } from '@linework/core';
import type { StepView } from '@linework/render';
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
  // A faded layer stands back on every page, at every step; what a step hides stays hidden.
  return drawings.flatMap((drawing) => {
    const list = stepPages(drawing, all);
    const faded = drawing.faded;
    if (!faded) return list;
    return list.map((p) => ({ ...p, view: p.view ? { ...p.view, states: p.view.states.map((s) => fadeState(s, faded)) } : { index: 0, states: [fadeState(undefined, faded)], caption: false } }));
  });
}

function stepPages(d: Drawing, all?: boolean): Page[] {
  return [d].flatMap((drawing): Page[] => {
    const states = drawing.steps;
    if (!states?.length) return [{ drawing }];
    if (drawing.step) return [{ drawing, view: { index: Math.min(states.length, Math.max(1, drawing.step)) - 1, states } }];
    if (!(all ?? !drawing.stepsImplied)) {
      // One page for the story: where it ends, not every step's lines at once.
      const end = drawing.stepsImplied ? undefined : finalState(states);
      return [{ drawing, ...(end ? { view: { index: 0, states: [end], caption: false, room: states } } : {}) }];
    }
    return states.map((_, index) => ({ drawing, view: { index, states } }));
  });
}
