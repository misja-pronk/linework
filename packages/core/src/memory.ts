// The previous drawing, remembered: the layout keeps what is already there where it was, so a
// small change to the YAML gives a small change in the picture (and a small diff in a pull request).
// In the sidecar it is one line per view; in the editor it lives in memory only.
import type { Box, LayoutMemory, LayoutNote, Point } from './model.ts';

const enc = encodeURIComponent;

/** The memory as the sidecar keeps it; positions only when asked for (they change with every edit). */
export function packLayout(m: LayoutMemory | undefined, positions: boolean): LayoutNote | undefined {
  if (!m) return undefined;
  const out: LayoutNote = {};
  if (m.variant) out.variant = m.variant;
  if (positions && m.nodes?.size) {
    const r = (n: number) => String(Math.round(n * 2) / 2);
    const nodes = [...m.nodes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, p]) => `${enc(id)}@${r(p.x)},${r(p.y)}`);
    const groups = [...(m.groups ?? [])].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, b]) => `#${enc(id)}@${r(b.x)},${r(b.y)},${r(b.width)},${r(b.height)}`);
    out.at = [...nodes, ...groups].join(';');
  }
  return out.variant || out.at ? out : undefined;
}

/** The sidecar's note as a memory; anything unreadable in it is skipped (a stale note is only a hint). */
export function unpackLayout(note: LayoutNote | undefined): LayoutMemory | undefined {
  if (!note || typeof note !== 'object') return undefined;
  const out: LayoutMemory = {};
  if (typeof note.variant === 'string') out.variant = note.variant;
  if (typeof note.at === 'string' && note.at) {
    const nodes = new Map<string, Point>();
    const groups = new Map<string, Box>();
    for (const part of note.at.split(';')) {
      const cut = part.lastIndexOf('@');
      if (cut < 1) continue;
      const nums = part.slice(cut + 1).split(',').map(Number);
      if (nums.some((n) => !Number.isFinite(n))) continue;
      let id: string;
      try {
        id = decodeURIComponent(part.slice(part.startsWith('#') ? 1 : 0, cut));
      } catch {
        continue;
      }
      if (part.startsWith('#') && nums.length === 4) groups.set(id, { x: nums[0]!, y: nums[1]!, width: nums[2]!, height: nums[3]! });
      else if (!part.startsWith('#') && nums.length === 2) nodes.set(id, { x: nums[0]!, y: nums[1]! });
    }
    if (nodes.size) {
      out.nodes = nodes;
      out.groups = groups;
    }
  }
  return out.variant || out.nodes ? out : undefined;
}

/** Whether two notes say the same (so the sidecar is only rewritten when the drawing changed). */
export function sameLayoutNote(a: LayoutNote | undefined, b: LayoutNote | undefined): boolean {
  return (a?.variant ?? '') === (b?.variant ?? '') && (a?.at ?? '') === (b?.at ?? '');
}
