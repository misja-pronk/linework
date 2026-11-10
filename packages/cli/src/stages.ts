// carto stages <file.yaml> -o out/: everything the stages of a diagram make, in one folder: each
// stage, the migration overview, each transition (overlay) and the as-is and to-be side by side,
// the roadmap (YAML and its drawing) and the story in words. --from a --to b: one transition.
import fs from 'node:fs';
import path from 'node:path';
import { render, type RenderOptions } from '@cartography/engine';
import { compareStages, stageStory, stagesRoadmap, storyMarkdown } from '@cartography/diff';
import type { Theme } from '@cartography/theme';

export interface StagesFlags {
  file: string;
  out?: string;
  format: 'svg' | 'png';
  from?: string;
  to?: string;
  sideBySide?: boolean;
  options: RenderOptions;
  png(svg: string, theme: Theme | undefined): Promise<Uint8Array>;
  say: { red(s: string): string; yellow(s: string): string; dim(s: string): string };
}

export async function stagesCommand(f: StagesFlags): Promise<number> {
  const { red, dim } = f.say;
  const text = fs.readFileSync(f.file, 'utf8');
  const base = path.basename(f.file).replace(/\.ya?ml$/i, '');
  const first = await render(text, { ...f.options, stage: 'overview' });
  const errors = first.diagnostics.filter((d) => d.severity === 'error');
  for (const d of first.diagnostics) console.error(`${f.file}${d.line ? `:${d.line}:${d.column}` : ''}  ${d.severity === 'error' ? red('error') : 'warning'}  ${d.message}`);
  if (errors.length) return 1;
  const list = first.stages;
  if (!list?.length) return (console.error(`${f.file}: this diagram has no stages: (see docs/transitions.md)`), 1);
  const dir = f.out ?? `${base}-stages`;
  fs.mkdirSync(dir, { recursive: true });
  const put = async (name: string, svg: string, theme: Theme | undefined, size: string) => {
    const file = path.join(dir, `${name}.${f.format}`);
    fs.writeFileSync(file, f.format === 'png' ? await f.png(svg, theme) : svg);
    console.log(`${f.file} → ${file} ${dim(size)}`);
  };
  const transition = async (a: string, b: string, side: boolean) => {
    const c = await compareStages(text, a, b, f.options);
    const pic = c && (side ? c.sideBySide() : c.picture());
    if (c && pic) await put(`${base}-${side ? 'side-by-side' : 'transition'}-${a}-${b}`, pic.svg, c.after?.theme, `${pic.width}×${pic.height}`);
  };
  // One transition asked for.
  if (f.from || f.to) {
    await transition(f.from ?? list[0]!.id, f.to ?? list.at(-1)!.id, !!f.sideBySide);
    return 0;
  }
  for (const [k, s] of list.entries()) {
    const r = await render(text, { ...f.options, stage: s.id });
    if (r.svg) await put(`${base}-stage-${k + 1}-${s.id}`, r.svg, r.theme, `${r.width}×${r.height}`);
  }
  if (first.svg) await put(`${base}-overview`, first.svg, first.theme, `${first.width}×${first.height}`);
  for (let k = 1; k < list.length; k++) await transition(list[k - 1]!.id, list[k]!.id, false);
  if (list.length > 2) await transition(list[0]!.id, list.at(-1)!.id, false);
  await transition(list[0]!.id, list.at(-1)!.id, true);
  const roadmap = await stagesRoadmap(text, f.options);
  if (roadmap) {
    const file = path.join(dir, `${base}-roadmap.yaml`);
    fs.writeFileSync(file, roadmap);
    console.log(`${f.file} → ${file}`);
    const r = await render(roadmap, { ...f.options, file: undefined, sidecar: undefined, view: undefined });
    if (r.svg) await put(`${base}-roadmap`, r.svg, r.theme, `${r.width}×${r.height}`);
  }
  const story = path.join(dir, `${base}-stages.md`);
  fs.writeFileSync(story, storyMarkdown(first.graph?.title ?? base, await stageStory(text, f.options)));
  console.log(`${f.file} → ${story}`);
  return 0;
}
