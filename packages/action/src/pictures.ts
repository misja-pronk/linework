// The diff pictures as PNG files: what a pull request comment can show. PNG, not SVG, because GitHub
// shows a PNG from anywhere and is particular about SVG; drawn with resvg, no browser.
import { ttfFiles } from '@cartography/cli/fonts';
import { toPng } from '@cartography/cli/png';
import type { Target } from './plan.ts';

export interface Shot {
  target: Target;
  /** File name, unique within one run: "docs-shop.png", "docs-model.containers.png". */
  name: string;
  data: Buffer;
  width: number;
  height: number;
}

export interface ShootOptions {
  /** Before and after next to each other instead of one marked-up drawing. */
  sideBySide?: boolean;
  /** What the older version is called in the picture ("main", "a1b2c3d"). */
  against?: string;
  /** What the newer one is called, side by side. */
  head?: string;
  /** Pixels per unit (default 2: sharp on a laptop screen). */
  scale?: number;
  /** At most this many pictures; the rest of the targets are reported in words only. */
  limit?: number;
}

/** "docs/shop.yaml" + "data" → "docs-shop.data" */
export function slug(file: string, view?: string): string {
  const base = file.replace(/\.ya?ml$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram';
  return view ? `${base}.${view.replace(/[^A-Za-z0-9_-]+/g, '-')}` : base;
}

export async function shoot(targets: Target[], opts: ShootOptions = {}): Promise<Shot[]> {
  const out: Shot[] = [];
  const taken = new Set<string>();
  for (const target of targets.slice(0, opts.limit ?? targets.length)) {
    const c = target.comparison;
    const overlay = { ...(opts.against ? { against: opts.against } : {}), labels: { before: opts.against ?? 'Before', after: opts.head ?? 'After' } };
    // Only the place of things differs: marks would say nothing, the two drawings next to each other do.
    const picture = opts.sideBySide || target.state === 'layout' ? c.sideBySide(overlay) : c.picture(overlay);
    if (!picture) continue;
    let name = slug(target.file, target.view);
    for (let n = 2; taken.has(name); n++) name = `${slug(target.file, target.view)}-${n}`;
    taken.add(name);
    const faces = (c.after ?? c.before)?.theme?.font.faces ?? [];
    out.push({ target, name: `${name}.png`, data: toPng(picture.svg, opts.scale ?? 2, await ttfFiles(faces)), width: picture.width, height: picture.height });
  }
  return out;
}
