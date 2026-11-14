// The alt text a slide or PDF page gives its drawing: the caller's, or the drawing told in words.
import { altText, describe } from '@cartography/describe';
import type { StepView } from '@cartography/render';
import type { Drawing } from './pptx.ts';
import { tr } from '@cartography/i18n/drawing';

/**
 * At most `max` characters, whole sentences: an alt text is read in one go. A page that shows one
 * step says that step and what the drawing is; the rest of the walkthrough is on its own pages.
 */
export function altOf(d: Drawing, max: number, view?: StepView): string {
  if (d.alt) return d.alt;
  const said = describe({ lang: d.lang, graph: d.graph, type: d.type, ...(d.typeName ? { typeName: d.typeName } : {}), steps: d.steps, stepsImplied: d.stepsImplied, name: d.name });
  const state = view?.states[view.index];
  if (!state || view?.caption === false) return altText(said, max);
  const step = [state.title, state.caption].filter(Boolean).join(': ');
  return `${said.title}, ${tr(d.lang, 'step {n} of {count}', { n: view!.index + 1, count: view!.states.length })}${step ? `: ${step}` : ''}${/[.!?]$/.test(step) ? '' : '.'} ${said.summary}`;
}
