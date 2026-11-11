// carto render <file.yaml…>: each diagram to SVG, PNG, PowerPoint or PDF; per view, step or layer when asked.
import fs from 'node:fs';
import path from 'node:path';
import { render, type RenderResult } from '@cartography/engine';
import { toSafeSvg } from '@cartography/export/svg-safe';
import type { Theme } from '@cartography/theme';
import type { RenderOptions } from '../args.ts';
import { describedPng } from '../describe.ts';
import { document, noteLayout, optionsFor, themeFlag } from '../draw.ts';
import { ttfFiles } from '../fonts.ts';
import { t } from '../i18n.ts';
import { outputPath, UsageError, type Ctx } from '../io.ts';
import { toPng } from '../png.ts';

type Format = 'svg' | 'png' | 'pptx' | 'pdf';
export const formats: Format[] = ['svg', 'png', 'pptx', 'pdf'];

/** One render of several files: the flags, how many files, and the --theme they share. */
export interface Job {
  o: RenderOptions;
  /** The command, for messages (render, watch). */
  command: string;
  /** How many files were given: one file name for several pictures is a mistake. */
  count: number;
  forced: Theme | undefined;
}

/** -o deck.pptx says the format as clearly as --format pptx; the extension wins for one file. */
function formatFor({ o, command, count }: Job): Format {
  const ext = o.out && count === 1 && o.out !== '-' ? path.extname(o.out).slice(1).toLowerCase() : '';
  if (!formats.includes(o.format as Format)) throw new UsageError(`--format ${o.format} is not one carto ${command} writes; use one of: ${formats.join(', ')}`);
  if (ext && !formats.includes(ext as Format)) throw new UsageError(`-o ${o.out}: carto ${command} writes ${formats.join(', ')}, not .${ext}`);
  return formats.find((f) => f === ext) ?? formats.find((f) => f === o.format) ?? 'svg';
}

/** `text`: the diagram when it is not (or not yet) what the file holds; `shown`: what it is called in messages. */
export async function renderFile(ctx: Ctx, job: Job, file: string, text = fs.readFileSync(file, 'utf8'), shown = file): Promise<boolean> {
  const { o } = job;
  const format = formatFor(job);
  // resvg reads fonts from files; embedding them in the SVG only makes the PNG step slower.
  // Office reads no embedded font either.
  const safe = !!o['svg-safe'] && format === 'svg';
  if (o['svg-safe'] && !safe) ctx.error(`${file}  ${ctx.yellow(t('warning'))}  ${t('--svg-safe is for SVG: ignored for {format}', { format })}`);
  if (o['outline-text'] && !safe) ctx.error(`${file}  ${ctx.yellow(t('warning'))}  ${t('--outline-text goes with --svg-safe: ignored')}`);
  const opts = optionsFor(ctx, o, file, o['no-fonts'] || safe || format !== 'svg' ? 'none' : 'embed', job.forced);
  const first = await render(text, opts);
  // --all-views: the diagram as written (or its first view) plus every view as <file>-<view>.svg.
  const views = o['all-views'] && first.views?.length ? await Promise.all(first.views.map((v) => render(text, { ...opts, view: v.name }))) : [];
  // A view with nothing in it is no picture: said, not written.
  for (const v of views) if (v.empty) ctx.error(`${shown}#${v.view}  ${ctx.dim(t('empty: nothing to draw, not written'))}`);
  // --all-layers: the drawing as a whole, then through each of its layers as <file>-<layer>.svg (a slide each in a deck).
  if (o['all-layers'] && !first.layers?.list.length) ctx.error(`${shown}  ${ctx.yellow(t('warning'))}  ${t('--all-layers: this diagram has no layers: (see docs/layers.md)')}`);
  const layered = o['all-layers'] ? await Promise.all((first.layers?.list ?? []).map((l) => render(text, { ...opts, layers: l.name }))) : [];
  for (const [i, l] of layered.entries()) if (l.empty || !l.layers?.kept) ctx.error(`${shown}@${first.layers!.list[i]!.name}  ${ctx.dim(t('nothing on this layer, not written'))}`);
  const runs = [first, ...views.filter((v) => !v.empty), ...layered.filter((l) => !l.empty && l.layers?.kept)];
  /** What a run is called in messages and file names: its view, or its layers. */
  const named = (r: RenderResult, i: number) => (i && layered.includes(r) ? [r.view, r.layers!.active.join('+')].filter(Boolean).join('-') : i ? r.view : o.view);
  const where = (format: string, view?: string, step?: number) => outputPath(o, job.count, file, format, view, step);
  if (o['all-layers'] && (format === 'pptx' || format === 'pdf')) {
    const drawn = runs.filter((r) => r.svg && !r.diagnostics.some((d) => d.severity === 'error'));
    for (const r of runs) ctx.report(r === first ? shown : `${shown}@${named(r, runs.indexOf(r))}`, r === first ? r.diagnostics : r.diagnostics.filter((d) => !first.diagnostics.some((f) => f.message === d.message)));
    if (!drawn.length) return false;
    const out = o.out === '-' ? '-' : where(format, o.view);
    // A layer is one slide (its steps are the whole drawing's story, told on its own slides), unless every step is asked for.
    const data = await document(ctx, o, format, drawn.map((r) => ({ ...r, name: path.basename(file), ...(r !== first && !o['all-steps'] ? { steps: undefined } : {}) })), first.theme, file);
    ctx.put(out, data);
    ctx.log(`${shown} → ${out === '-' ? t('standard output') : out} ${ctx.dim(t('{all} drawings: the whole and {count} layer|{all} drawings: the whole and {count} layers', { all: drawn.length, count: drawn.length - 1 }))}`);
    if (o.stable) noteLayout(ctx, file, runs);
    return drawn.length === runs.length;
  }
  let ok = true;
  const stdout = o.out === '-' || (shown === 'stdin' && !o.out);
  for (const [i, result] of runs.entries()) {
    const view = named(result, i);
    ctx.report(view && i ? `${shown}${layered.includes(result) ? '@' : '#'}${view}` : shown, i && !o.view ? result.diagnostics.filter((d) => !first.diagnostics.some((f) => f.message === d.message)) : result.diagnostics);
    if (!result.svg) {
      ok = false;
      continue;
    }
    if ((o.step || (o['all-steps'] && !o['all-views'])) && !result.steps) ctx.error(`${shown}${view ? `#${view}` : ''}  ${ctx.yellow(t('warning'))}  ${t('no steps here: drawn as a whole')}`);
    // --all-steps: an image per step, numbered; a pptx or pdf holds them all in one file.
    const each = o['all-steps'] && result.steps && (format === 'svg' || format === 'png');
    const shots = each ? await Promise.all(result.steps!.map((_, n) => render(text, { ...opts, view: result.view ?? opts.view, ...(layered.includes(result) ? { layers: result.layers!.active } : {}), step: n + 1 }))) : [result];
    if (stdout && runs.length + shots.length > 2) throw new UsageError(t('-o - writes one picture to standard output: give a folder for --all-views or --all-steps'));
    // A drawing with errors is not what was asked for: nothing is written, the errors say why.
    if (result.diagnostics.some((d) => d.severity === 'error')) {
      ctx.error(`${shown}${view ? `#${view}` : ''}  ${ctx.red(t('error'))}  ${t('nothing written')}`);
      ok = false;
      continue;
    }
    const faces = result.theme?.font.faces ?? [];
    const outline = safe && o['outline-text'] ? await (await import('../outline.ts')).outliner(result.theme) : undefined;
    for (const shot of shots) {
      if (!shot.svg) continue;
      const out = stdout ? '-' : where(format, view, each || o.step ? shot.step : undefined);
      const data =
        format === 'png' ? await describedPng(shot, file, toPng(shot.svg, Number(o.scale) || 2, await ttfFiles(faces)))
        : safe ? toSafeSvg(shot.svg, { outline })
        : format === 'svg' ? shot.svg
        : await document(ctx, o, format, [{ ...shot, name: path.basename(file) }], shot.theme, file);
      ctx.put(out, data);
      (stdout ? ctx.error : ctx.log)(`${shown}${view ? `${layered.includes(result) ? '@' : '#'}${view}` : ''}${shot.step ? ` ${t('step {n}', { n: shot.step })}` : ''} → ${stdout ? t('standard output') : out} ${ctx.dim(`${shot.width}×${shot.height}`)}`);
    }
  }
  if (o.stable) noteLayout(ctx, file, runs);
  return ok;
}

/** carto render: every file given; `-` is standard input. */
export async function renderCommand(ctx: Ctx, files: string[], o: RenderOptions, usage: () => number): Promise<number> {
  if (!files.length) return usage();
  if (!formats.includes(o.format as Format)) throw new UsageError(`--format ${o.format} is not one carto render writes; use one of: ${formats.join(', ')}`);
  if (!(Number(o.scale) > 0)) throw new UsageError(`--scale ${o.scale}: give a number above 0, e.g. --scale 2`);
  const forced = themeFlag(ctx, o.theme);
  if (forced === false) return 1;
  const job: Job = { o, command: 'render', count: files.length, forced };
  let ok = true;
  for (const f of files) {
    // `-` reads the diagram from standard input; the picture then goes to standard output unless -o says where.
    if (f === '-') ok = (await renderFile(ctx, job, path.resolve('stdin.yaml'), ctx.io.stdin(), 'stdin')) && ok;
    else ok = (await renderFile(ctx, job, f)) && ok;
  }
  return ok ? 0 : 1;
}
