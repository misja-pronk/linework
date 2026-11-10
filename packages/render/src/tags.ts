// Small text tags drawn on elements and lines: threat numbers (T1, T2) and the ends of a context
// map's relationships (U, D, ACL, OHS). They say what they mean in text, so colour only helps.
import type { Point } from '@cartography/core';
import { baselineOffset, measureText, type Theme } from '@cartography/theme';
import { esc, r1 } from './paint.ts';

export const TAG = { H: 16, PAD: 5, SIZE: 9.5, GAP: 3 } as const;

/** At most three numbers, then "+2": a card never grows a row of tags. */
export function shownTags(tags: string[]): string[] {
  return tags.length <= 3 ? tags : [...tags.slice(0, 2), `+${tags.length - 2}`];
}

const tagWidth = (s: string) => measureText(s, TAG.SIZE, 600) + 2 * TAG.PAD;

export function tagsWidth(tags: string[]): number {
  const shown = shownTags(tags);
  return shown.reduce((a, s) => a + tagWidth(s), 0) + Math.max(0, shown.length - 1) * TAG.GAP;
}

/** How a tag is drawn: a threat in the threat colour, outlined; an end of a relationship in ink. */
export type TagStyle = 'threat' | 'end' | 'pattern';

export function tagColors(theme: Theme, style: TagStyle) {
  if (style === 'threat') return { fill: theme.surface, stroke: theme.tones.rose.fg, ink: theme.tones.rose.fg };
  if (style === 'end') return { fill: theme.text, stroke: theme.text, ink: theme.surface };
  return { fill: theme.surface, stroke: theme.text, ink: theme.text };
}

/** Tags in a row starting at x, centred on cy. */
export function drawTags(theme: Theme, tags: string[], x: number, cy: number, style: TagStyle | ((tag: string) => TagStyle) = 'threat'): string {
  let s = '';
  for (const t of shownTags(tags)) {
    const w = tagWidth(t);
    const c = tagColors(theme, typeof style === 'function' ? style(t) : style);
    s += `<rect x="${r1(x + 0.5)}" y="${r1(cy - TAG.H / 2 + 0.5)}" width="${r1(w - 1)}" height="${TAG.H - 1}" rx="3.5" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/>`;
    s += `<text x="${r1(x + w / 2)}" y="${r1(cy + baselineOffset(TAG.SIZE))}" font-size="${TAG.SIZE}" font-weight="600" fill="${c.ink}" text-anchor="middle">${esc(t)}</text>`;
    x += w + TAG.GAP;
  }
  return s;
}

/** Where a tag row sits each tag, for exports that draw them as shapes. */
export function tagBoxes(tags: string[], x: number, cy: number): { text: string; x: number; y: number; width: number; height: number }[] {
  return shownTags(tags).map((t) => {
    const w = tagWidth(t);
    const box = { text: t, x, y: cy - TAG.H / 2, width: w, height: TAG.H };
    x += w + TAG.GAP;
    return box;
  });
}

/** Room an end tag row keeps from the element it sits against. */
const END_GAP = 6;

/**
 * Where the tags at one end of a line go: on the line, just clear of the element, centred across it.
 * `tip` is the end of the line, `from` the point before it. Returns the left edge and centre.
 */
export function endTagAt(tags: string[], tip: Point, from: Point): { x: number; cy: number } {
  const w = tagsWidth(tags);
  const dx = Math.sign(from.x - tip.x);
  const dy = Math.sign(from.y - tip.y);
  if (dx !== 0 && Math.abs(from.y - tip.y) < 0.5) {
    // Level: the row lies along the line, starting just clear of the element.
    const x = dx > 0 ? tip.x + END_GAP : tip.x - END_GAP - w;
    return { x, cy: tip.y };
  }
  // Upright: the row lies across the line, a little in from the element.
  const cy = tip.y + (dy || 1) * (END_GAP + TAG.H / 2);
  return { x: tip.x - w / 2, cy };
}
