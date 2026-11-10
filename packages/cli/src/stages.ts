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

/**
 * carto deck --stages: a slide per stage with a transition slide between each two (what is added,
 * changed, removed and replaced), then the overview, the as-is and to-be side by side and the
 * roadmap. Pictures, so the marks come along; every stage slide is the same size, so they line up.
 */
export async function stagesDeck(files: string[], options: (file: string) => RenderOptions, png: (svg: string, theme: Theme | undefined) => Promise<Uint8Array>, title?: string): Promise<{ data: Uint8Array; slides: number } | undefined> {
  const { toPictureDeck } = await import('@cartography/export');
  const slides: Parameters<typeof toPictureDeck>[0] = [];
  let theme: Theme | undefined;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const opts = { ...options(file), stage: undefined };
    const story = await stageStory(text, opts);
    if (!story.length) {
      console.error(`${file}: no stages: (see docs/transitions.md), left out`);
      continue;
    }
    const slide = async (name: string, sub: string | undefined, pic: { svg: string; width: number; height: number } | undefined, t: Theme | undefined, notes: string[]) => {
      if (!pic) return;
      theme ??= t;
      slides.push({ title: name, ...(sub ? { subtitle: sub } : {}), svg: pic.svg, png: await png(pic.svg, t), width: pic.width, height: pic.height, notes });
    };
    for (const [k, { stage, told }] of story.entries()) {
      if (k) {
        const c = await compareStages(text, story[k - 1]!.stage.id, stage.id, opts);
        await slide(`From ${story[k - 1]!.stage.title} to ${stage.title}`, stage.when, c?.picture(), c?.after?.theme, told.map((t) => t.text));
      }
      const r = await render(text, { ...opts, fonts: 'none', stage: stage.id });
      await slide(stage.title, stage.when, r.svg ? { svg: r.svg, width: r.width!, height: r.height! } : undefined, r.theme, [stage.description ?? '', ...told.map((t) => t.text)].filter(Boolean));
    }
    const all = await render(text, { ...opts, fonts: 'none', stage: 'overview' });
    await slide('Migration overview', undefined, all.svg ? { svg: all.svg, width: all.width!, height: all.height! } : undefined, all.theme, ['Every element with the stage it is added (+), changed (~) and gone (−) in.']);
    const [first, last] = [story[0]!.stage, story.at(-1)!.stage];
    const both = await compareStages(text, first.id, last.id, opts);
    await slide(`${first.title} and ${last.title}`, undefined, both?.sideBySide(), both?.after?.theme, both?.told.map((t) => t.text) ?? []);
    const roadmap = await stagesRoadmap(text, opts);
    if (roadmap) {
      const r = await render(roadmap, { ...opts, fonts: 'none', file: undefined, sidecar: undefined });
      await slide('Roadmap', undefined, r.svg ? { svg: r.svg, width: r.width!, height: r.height! } : undefined, r.theme, ['Made from the stages: an item per change, a band per stage.']);
    }
  }
  if (!slides.length) return undefined;
  return { data: toPictureDeck(slides, { theme, ...(title ? { title } : {}) }), slides: slides.length };
}
