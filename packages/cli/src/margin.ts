// Slide margin lab: how far the examples are from text under 6 pt on their slide, and whether an
// edit a consultant makes live (one label 8 characters longer) tips them under it. Each example (each
// view, each written step) is measured as linework validate measures it, through the PowerPoint export;
// then, up to six times per file, one label is lengthened in memory and the file is measured again.
//   pnpm margin                the distribution of the smallest text per view, and the edits that tip under
//   pnpm margin azure          only the examples with "azure" in their path
//   pnpm margin --json         the same as JSON
//   pnpm margin --all          every label lengthened in turn, not six per file
import fs from 'node:fs';
import path from 'node:path';
import { render, SLIDE_MIN_PT, type RenderResult } from '@linework/engine';
import { toPptx, type SlideText } from '@linework/export';

const root = path.resolve(import.meta.dirname, '../../..');
/** What each lengthened label gets: 8 characters. */
const LONGER = ' extra +';
const EDITS = 6;

function exampleFiles(): string[] {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.yaml') ? [path.join(d, e.name)] : []));
  return walk(path.join(root, 'examples'))
    .map((f) => path.relative(root, f))
    .sort();
}

async function slides(x: RenderResult, name: string, steps: boolean): Promise<SlideText[]> {
  const seen: SlideText[] = [];
  await toPptx({ ...x, name }, { ...(x.theme ? { theme: x.theme } : {}), steps, onSlide: (s) => seen.push(s), onWarning: () => {} });
  return seen;
}

/** The smallest text (pt) of each view on its slide, and of each written step; as validate measures. */
async function measureText(text: string, file: string): Promise<Map<string, number>> {
  const load = (rel: string) => fs.readFileSync(path.resolve(path.dirname(path.join(root, file)), rel), 'utf8');
  const opts = { fonts: 'none' as const, load, file: path.basename(file) };
  const r = await render(text, opts);
  const rest = await Promise.all((r.views ?? []).map((v) => render(text, { ...opts, view: v.name })));
  const out = new Map<string, number>();
  for (const x of [r, ...rest.filter((v) => v.view !== r.view && v.svg !== r.svg)]) {
    if (!x.svg || !x.graph || !x.placed || x.scroll || x.diagnostics.some((d) => d.severity === 'error')) continue;
    if (x.page && !x.page.name.endsWith('slide')) continue;
    const whole = (await slides(x, path.basename(file), false).catch(() => []))[0]?.smallestPt;
    if (whole == null) continue;
    const name = x.view ?? '(drawing)';
    out.set(name, whole);
    if (x.steps && !x.stepsImplied) for (const s of await slides(x, path.basename(file), true).catch(() => [])) if (s.step) out.set(`${name} step ${s.step}`, s.smallestPt);
  }
  return out;
}

/** Where the labels are in the source: `label: Words` (bare or quoted), in a flow map or on its own line. */
function labels(text: string): { at: number; end: number }[] {
  const found: { at: number; end: number }[] = [];
  for (const m of text.matchAll(/\blabel: *(?:"([^"\n]+)"|'([^'\n]+)'|([^,}\n#"'[{][^,}\n#]*))/g)) {
    const word = m[1] ?? m[2] ?? m[3]!.trimEnd();
    const at = m.index! + m[0].indexOf(word);
    found.push({ at, end: at + word.length });
  }
  return found;
}

interface Tip {
  file: string;
  label: string;
  view: string;
  before: number;
  after: number;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const every = args.includes('--all');
  const only = args.filter((a) => !a.startsWith('--'));
  const files = exampleFiles().filter((f) => !only.length || only.some((o) => f.includes(o)));
  const views: { file: string; view: string; pt: number }[] = [];
  const tips: Tip[] = [];
  let trials = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    if (!/^type:/m.test(text) && !/^(nodes|groups|edges):/m.test(text)) continue;
    let base: Map<string, number>;
    try {
      base = await measureText(text, file);
    } catch {
      continue;
    }
    if (!base.size) continue;
    for (const [view, pt] of base) if (!view.includes(' step ')) views.push({ file, view, pt });
    const all = labels(text);
    const picked = every || all.length <= EDITS ? all : Array.from({ length: EDITS }, (_, i) => all[Math.floor((i * all.length) / EDITS)]!);
    for (const l of picked) {
      const edited = text.slice(0, l.end) + LONGER + text.slice(l.end);
      let after: Map<string, number>;
      try {
        after = await measureText(edited, file);
      } catch {
        continue;
      }
      trials++;
      const worst = [...after].filter(([v, pt]) => pt < SLIDE_MIN_PT && (base.get(v) ?? Infinity) >= SLIDE_MIN_PT).sort((a, b) => a[1] - b[1])[0];
      if (worst) tips.push({ file, label: text.slice(l.at, l.end), view: worst[0], before: base.get(worst[0])!, after: worst[1] });
    }
    if (!json) process.stderr.write('.');
  }
  const bins = new Map<string, number>();
  const bin = (pt: number) => (pt < 6 ? '< 6.0' : pt < 6.05 ? '6.0' : pt < 6.45 ? '6.1–6.4' : pt < 6.95 ? '6.5–6.9' : pt < 8 ? '7.0–7.9' : '8+');
  for (const v of views) bins.set(bin(v.pt), (bins.get(bin(v.pt)) ?? 0) + 1);
  const order = ['< 6.0', '6.0', '6.1–6.4', '6.5–6.9', '7.0–7.9', '8+'];
  if (json) return void console.log(JSON.stringify({ views, trials, tips }, null, 1));
  console.log(`\n${views.length} slide views; smallest text per view:`);
  for (const k of order) console.log(`  ${k.padEnd(8)} ${bins.get(k) ?? 0}`);
  console.log(`\n${tips.length} of ${trials} edits (one label ${LONGER.length} characters longer) tip a view under ${SLIDE_MIN_PT} pt:`);
  for (const t of tips) console.log(`  ${t.file} [${t.view}] "${t.label}": ${t.before.toFixed(1)} → ${t.after.toFixed(1)}`);
}

await main();
