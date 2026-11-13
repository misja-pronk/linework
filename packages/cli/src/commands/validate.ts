// carto validate <file.yaml…|folder>: each diagram and each of its views, the problems printed; --drift the sidecar too.
import fs from 'node:fs';
import path from 'node:path';
import { isDiagramFile, type LayoutSidecar } from '@cartography/core';
import { drift, render, SLIDE_MIN_PT, slideTextPt, type RenderResult } from '@cartography/engine';
import { stepCaptionLines, toPptx, type PptxOptions, type SlideText } from '@cartography/export';
import type { ValidateOptions } from '../args.ts';
import { langOption, templateFlags } from '../draw.ts';
import { t } from '../i18n.ts';
import { dataFiles, isFolder, sidecarPath, writeSidecar, type Ctx } from '../io.ts';
import { readPack } from '../packs.ts';

/** validate --drift: what the sidecar still refers to that the diagram no longer has. */
async function checkDrift(ctx: Ctx, o: ValidateOptions, file: string): Promise<boolean> {
  const { red, yellow, dim } = ctx;
  const p = sidecarPath(file);
  if (!fs.existsSync(p)) return true;
  let sidecar: LayoutSidecar | undefined;
  try {
    sidecar = ctx.sidecarFor(file);
  } catch (e) {
    ctx.error(`${red(t('error'))}  ${(e as Error).message}`);
    return false;
  }
  if (!sidecar) return false;
  const r = await drift(fs.readFileSync(file, 'utf8'), sidecar, { load: ctx.loaderFor(file), file: path.basename(file), packs: o.pack, pack: readPack });
  if (r.error) return (ctx.error(`${p}  ${yellow(t('warning'))}  ${r.error}`), true);
  if (!r.stale.length) return true;
  const fixing = !!o.fix;
  for (const s of r.stale) ctx.error(`${p}  ${fixing ? yellow(t('fixed')) : red(t('stale'))}  ${s.path}: ${s.message}`);
  const count = r.stale.length;
  if (!fixing) return (ctx.error(`${p}  ${t('{count} stale entry; carto validate --drift --fix {file} drops it|{count} stale entries; carto validate --drift --fix {file} drops them', { count, file })}`), false);
  writeSidecar(file, r.fixed);
  ctx.log(`${p} ${dim(r.fixed ? t('{count} stale entry dropped|{count} stale entries dropped', { count }) : t('{count} stale entry dropped, nothing left: file removed|{count} stale entries dropped, nothing left: file removed', { count }))}`);
  return true;
}

/** "2, 3 and 5": numbers said as a list. */
const listed = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** How the deck of a file is made: our own slides of its aspect, or the template its theme names (pptx:) or --template gives. */
type Deck = Pick<PptxOptions, 'aspect' | 'template' | 'layout' | 'keepLook'>;

/** The page a drawing is said to be on: "16:9 slide", or a slide of the template. */
const pageName = (x: RenderResult, deck: Deck) => (deck.template ? 'slide of the template' : (x.page?.name ?? '16:9 slide'));

/**
 * The slides the deck makes of a drawing, each with the smallest text a reader needs on it (pt): asked
 * of the PowerPoint export itself, so what validate says is what PowerPoint shows. `steps`: a slide per
 * written step; else the one slide of the whole drawing.
 */
async function slidesOf(x: RenderResult, name: string, deck: Deck, steps: boolean): Promise<SlideText[]> {
  const seen: SlideText[] = [];
  await toPptx({ ...x, name }, { ...deck, ...(x.theme ? { theme: x.theme } : {}), steps, onSlide: (s) => seen.push(s), onWarning: () => {} });
  return seen;
}

/**
 * The written steps of a drawing whose slide (the PowerPoint export: the step's title and caption are
 * text on the slide, notes beside what they are about) has its smallest text under SLIDE_MIN_PT, as one
 * warning; nothing when they all read. `whole`: the drawing's own slide, already checked; a drawing that
 * is already too small for a slide, or read scrolling, is not checked again.
 */
async function smallSteps(x: RenderResult, name: string, deck: Deck, whole: number): Promise<string | undefined> {
  if (!x.steps || x.stepsImplied || x.scroll || whole < SLIDE_MIN_PT) return undefined;
  const aspect = deck.aspect ?? '16:9';
  const small = (await slidesOf(x, name, deck, true)).map((s) => ({ step: s.step ?? 0, pt: s.smallestPt })).filter((s) => s.step && s.pt < SLIDE_MIN_PT);
  if (!small.length) return undefined;
  const steps = x.steps;
  const named = (n: number) => `${n}${steps[n - 1]?.title ? ` "${steps[n - 1]!.title}"` : ''}`;
  const pts = [...new Set(small.map((s) => s.pt))].sort((a, b) => a - b);
  const range = pts.length > 1 ? `${pts[0]!.toFixed(1)}–${pts.at(-1)!.toFixed(1)}` : pts[0]!.toFixed(1);
  // The steps of a drawing share one layout, so the drawing stays put: a step is as small as the longest caption makes all of them.
  const which = small.length === steps.length ? (steps.length === 1 ? 'Its step' : `All ${steps.length} steps`) : small.length === 1 ? `Step ${named(small[0]!.step)}` : `Steps ${listed(small.map((s) => named(s.step)))}`;
  const long = deck.template ? [] : steps.map((s, i) => ({ n: i + 1, lines: stepCaptionLines(s, aspect) })).filter((s) => s.lines > 1);
  const why = long.length
    ? `the title and caption of ${long.length === 1 ? 'step' : 'steps'} ${listed(long.map((s) => named(s.n)))} ${long.length === 1 ? 'run' : 'each run'} to ${Math.max(...long.map((s) => s.lines))} lines, and every step keeps room for the longest: shorten ${long.length === 1 ? 'it' : 'them'} to one line`
    : 'the step title and caption under the slide title, and notes beside the drawing, take that room: shorten the notes, or split the drawing into views';
  return `${x.view ? `View "${x.view}", ${which[0]!.toLowerCase()}${which.slice(1)}` : which}: on a ${pageName(x, deck)} ${small.length === 1 ? 'its' : 'their'} smallest text is ${range} pt, under ${SLIDE_MIN_PT} pt (the drawing alone: ${whole.toFixed(1)} pt): ${why}`;
}

export async function validateCommand(ctx: Ctx, files: string[], o: ValidateOptions): Promise<number> {
  let ok = true;
  // A folder: each diagram in it.
  const folders = files.filter(isFolder);
  for (const given of files.filter((x) => !isFolder(x)).concat(folders.flatMap((d) => dataFiles(d).filter((x) => isDiagramFile(x, fs.readFileSync(x, 'utf8')))))) {
    // `-` reads the diagram from standard input, as carto render - does.
    const stdin = given === '-';
    const f = stdin ? path.resolve('stdin.yaml') : given;
    const shown = stdin ? 'stdin' : given;
    const text = stdin ? ctx.io.stdin() : fs.readFileSync(f, 'utf8');
    const opts = { fonts: 'none' as const, load: ctx.loaderFor(f), file: path.basename(f), ...langOption(ctx) };
    const r = await render(text, { ...opts, view: o.view });
    // Without --view every view is checked too: what a view says about itself (complete: true for
    // an environment) is only known when that view is drawn. The same problem is printed once.
    const rest = o.view ? [] : await Promise.all((r.views ?? []).map((v) => render(text, { ...opts, view: v.name })));
    const seen = new Set<string>();
    const diagnostics = [r, ...rest].flatMap((x) => x.diagnostics).filter((d) => !seen.has(`${d.line}:${d.column}:${d.message}`) && !!seen.add(`${d.line}:${d.column}:${d.message}`));
    // On its slide in the PowerPoint export (a 16:9 slide unless aspect: says otherwise, or the template's), the smallest
    // text of each drawing should still be readable: measured on the slide the export makes, not estimated.
    // A drawing meant for a sheet of paper (aspect: a4) is measured fitted onto that sheet.
    // A drawing that is read scrolling (a whole sequence) goes on slides as its other views: those are checked, it only gets a hint.
    const hints: string[] = [];
    const deck: Deck = { aspect: r.page?.name.startsWith('4:3') ? '4:3' : '16:9', ...templateFlags(ctx, o, r.theme, f) };
    // The type's own view the file is written for draws the same: told once.
    for (const x of [r, ...rest.filter((v) => v.view !== r.view && v.svg !== r.svg)]) {
      if (!x.svg || !x.width || !x.height || !x.graph || !x.placed || x.diagnostics.some((d) => d.severity === 'error')) continue;
      const sheet = !!x.page && !x.page.name.endsWith('slide');
      const pt = (sheet ? undefined : (await slidesOf(x, path.basename(f), deck, false).catch(() => []))[0]?.smallestPt) ?? slideTextPt(x.svg, x.width, x.height, x.page);
      if (pt == null) continue;
      const page = sheet ? x.page!.name : pageName(x, deck);
      if (pt < SLIDE_MIN_PT) {
        if (x.scroll) {
          const by = (r.views ?? []).filter((v) => !rest.find((w) => w.view === v.name)?.scroll).map((v) => v.name);
          const hint = `On a ${page} the whole drawing is ${pt.toFixed(1)} pt: a deck presents it per view (${by.join(', ')})`;
          if (!hints.includes(hint)) hints.push(hint);
        } else diagnostics.push({ severity: 'warning', message: `${x.view ? `View "${x.view}": o` : 'O'}n a ${page} its smallest text is ${pt.toFixed(1)} pt, under ${SLIDE_MIN_PT} pt: split it into views, or let it wrap (aspect: 16:9)` });
        continue;
      }
      // Each step is a slide of its own, its title and caption on it: those that come out smaller than the drawing allows, said once per drawing.
      const small = sheet ? undefined : await smallSteps(x, path.basename(f), deck, pt);
      if (small) diagnostics.push({ severity: 'warning', message: small });
    }
    ctx.report(shown, diagnostics);
    for (const h of hints) ctx.error(`${shown}  ${ctx.dim(t('hint'))}  ${h}`);
    const drifted = o.drift && !stdin && !(await checkDrift(ctx, o, f));
    if (diagnostics.some((d) => d.severity === 'error') || drifted) ok = false;
    else ctx.log(`${shown} ${ctx.dim(t('ok'))}`);
  }
  return ok ? 0 : 1;
}
