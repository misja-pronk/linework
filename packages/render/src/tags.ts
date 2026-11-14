// Small text tags drawn on elements and lines: the environments something is in, and the ends of a
// context map's relationships (U, D, ACL, OHS). They say what they mean in text, so colour only helps.
import type { Box, Marker, Point } from '@linework/core';
import { baselineOffset, measureText, type Theme } from '@linework/theme';
import { esc, r1 } from './paint.ts';
import { SMALL_PX } from './readable.ts';

export const TAG = { H: 16, PAD: 5, SIZE: SMALL_PX, GAP: 3 } as const;

/** At most three numbers, then "+2": a card never grows a row of tags. */
export function shownTags(tags: string[]): string[] {
  return tags.length <= 3 ? tags : [...tags.slice(0, 2), `+${tags.length - 2}`];
}

const tagWidth = (s: string) => measureText(s, TAG.SIZE, 600) + 2 * TAG.PAD;

export function tagsWidth(tags: string[]): number {
  const shown = shownTags(tags);
  return shown.reduce((a, s) => a + tagWidth(s), 0) + Math.max(0, shown.length - 1) * TAG.GAP;
}

/** How a tag is drawn: outlined in ink, or an end of a relationship filled in ink. */
export type TagStyle = 'end' | 'pattern';

export function tagColors(theme: Theme, style: TagStyle) {
  if (style === 'end') return { fill: theme.text, stroke: theme.text, ink: theme.surface };
  return { fill: theme.surface, stroke: theme.text, ink: theme.text };
}

/** End tags of a line: in ink for the side (U, D), outlined for a pattern (ACL, OHS). */
export const endStyle = (tag: string): TagStyle => (tag === 'U' || tag === 'D' ? 'end' : 'pattern');

/** Tags in a row starting at x, centred on cy. */
export function drawTags(theme: Theme, tags: string[], x: number, cy: number, style: TagStyle | ((tag: string) => TagStyle) = 'pattern'): string {
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
export function endTagAt(tags: string[], tip: Point, from: Point, taken: (Box & { text?: string })[] = [], marker: Marker = 'none', lines: Box[] = []): { x: number; cy: number } | undefined {
  const w = tagsWidth(tags);
  // Past a UML end (a diamond, a triangle), so the tag does not cover it.
  const gap = END_GAP + markerLength(marker);
  const dx = Math.sign(from.x - tip.x);
  const dy = Math.sign(from.y - tip.y);
  const level = dx !== 0 && Math.abs(from.y - tip.y) < 0.5;
  const along = level ? Math.abs(from.x - tip.x) : Math.abs(from.y - tip.y);
  const hit = (b: Box) => taken.some((t) => b.x < t.x + t.width && t.x < b.x + b.width && b.y < t.y + t.height && t.y < b.y + b.height);
  // Level: the row lies along the line, starting just clear of the element. Upright: across it.
  // Upright, the row is centred across the line, unless another line comes in beside it: then it
  // sits wholly on the far side of its own line, where it cannot be read as the neighbour's.
  const across = (b: Box) => lines.some((l) => b.x - 4 < l.x + l.width && l.x < b.x + b.width + 4 && b.y < l.y + l.height && l.y < b.y + b.height);
  const rowAt = (x: number, shift: number) => ({ x, cy: tip.y + (dy || 1) * (gap + TAG.H / 2 + shift) });
  const box = (p: { x: number; cy: number }) => ({ x: p.x, y: p.cy - TAG.H / 2, width: w, height: TAG.H });
  const xs = [tip.x - w / 2, tip.x + 5, tip.x - 5 - w];
  const ux = level ? 0 : (xs.find((x) => !across(box(rowAt(x, 0)))) ?? xs[0]!);
  const place = (shift: number) => (level ? { x: dx > 0 ? tip.x + gap + shift : tip.x - gap - w - shift, cy: tip.y } : rowAt(ux, shift));
  // Lines that leave on one trunk share their first tags: drawn once.
  const first = place(0);
  if (taken.some((t) => t.text === tags.join(' ') && Math.abs(t.x - first.x) < 1 && Math.abs(t.y + TAG.H / 2 - first.cy) < 1)) return undefined;
  // Lines that meet an element side by side: a row that would cover another's slides further along its own line.
  const step = level ? w + TAG.GAP : TAG.H + TAG.GAP;
  // Never past the middle of the line, where the other end's tags and the label are: then the first place it is.
  let at = place(0);
  for (let shift = 0; shift + gap + (level ? w : TAG.H) <= along / 2; shift += step) {
    const p = place(shift);
    if (!hit({ x: p.x, y: p.cy - TAG.H / 2, width: w, height: TAG.H })) {
      at = p;
      break;
    }
  }
  taken.push({ x: at.x, y: at.cy - TAG.H / 2, width: w, height: TAG.H, text: tags.join(' ') });
  return at;
}

/** How far a UML end reaches back along its line from the tip. */
export const markerLength = (m: Marker) => (m === 'triangle' ? 13 : m === 'diamond' || m === 'filledDiamond' ? 16 : m === 'open' ? 10 : 0);

/**
 * Room the tags at a line's ends take on each side of its label: the label box is made this much wider
 * on both sides, so the layout leaves the line long enough for both ends and the label between them.
 */
export function endsRoom(ends: { from?: string[]; to?: string[] } | undefined): number {
  if (!ends) return 0;
  return Math.max(ends.from?.length ? tagsWidth(ends.from) : 0, ends.to?.length ? tagsWidth(ends.to) : 0) + 2 * END_GAP + 8;
}
