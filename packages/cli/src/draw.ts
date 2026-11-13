// What the drawing commands share: the render options a diagram is drawn with, --theme, --icons,
// --focus, the deck or PDF of drawings (and its PowerPoint template), and the --stable layout note.
import fs from 'node:fs';
import path from 'node:path';
import { layerKey, SLIDE_MIN_PT, type RenderOptions, type RenderResult } from '@cartography/engine';
import { readTemplate, toPdf, toPptx, type Drawing, type PptxOptions, type SlideText } from '@cartography/export';
import { isThemeFile, resolveTheme, themes, type Theme } from '@cartography/theme';
import { packLayout, sameLayoutNote, viewPins, withViewPins } from '@cartography/core';
import type { DocumentOptions, DrawOptions } from './args.ts';
import { fontScale } from './fonts.ts';
import { t } from './i18n.ts';
import { sidecarPath, UsageError, writeSidecar, type Ctx } from './io.ts';
import { readPack } from './packs.ts';
import { iconPng, interTtf, themeTtf } from './png.ts';

/**
 * --theme: a name, or a theme file relative to where carto runs; read once for all files. Undefined
 * without --theme, false when it is neither (said).
 */
export function themeFlag(ctx: Ctx, theme: string | undefined): Theme | undefined | false {
  if (!theme) return undefined;
  if (themes[theme]) return themes[theme];
  if (!isThemeFile(theme)) return (ctx.error(t('Unknown theme "{name}", use one of: {themes}, or a .theme.yaml file', { name: theme, themes: Object.keys(themes).join(', ') })), false);
  const cwd = path.resolve(theme);
  const r = resolveTheme(path.basename(cwd), { load: ctx.loaderFor(cwd), assets: ctx.assetsFor(cwd) });
  for (const w of r.warnings) ctx.error(`${theme}  ${ctx.yellow(t('warning'))}  ${w.path.length ? w.path.join('.') + ': ' : ''}${w.message}`);
  return r.theme;
}

/** --focus orders --hops 2 --upstream, as the focus: of a diagram would say it; undefined without --focus. */
export function focusFlag(o: Pick<DrawOptions, 'focus' | 'hops' | 'upstream' | 'downstream'>): RenderOptions['focus'] {
  if (!o.focus?.length) return undefined;
  const hops = o.hops === 'all' ? 'all' : o.hops != null && Number(o.hops) >= 0 ? Math.floor(Number(o.hops)) : 1;
  return { on: o.focus, hops, direction: o.upstream && !o.downstream ? 'upstream' : o.downstream && !o.upstream ? 'downstream' : 'both' };
}

/** --icons official|lucide; anything else is a usage error. */
export function iconsFlag(v: string | undefined): RenderOptions['iconsOverride'] {
  if (v == null) return undefined;
  if (v === 'official' || v === 'lucide') return v;
  throw new UsageError(t('--icons is official or lucide, not "{value}"', { value: v }));
}

/** --lang or CARTO_LANG: the language of the drawing's own words when a diagram has no lang: (never the machine's locale). */
export const langOption = (ctx: Ctx): Pick<RenderOptions, 'lang'> => (ctx.lang ? { lang: ctx.lang } : {});

/** How one diagram file is drawn: its sidecar, includes and assets beside it, and the flags. */
export function optionsFor(ctx: Ctx, o: DrawOptions, file: string, fonts: RenderOptions['fonts'], forced?: Theme): RenderOptions {
  return {
    themeOverride: forced,
    sidecar: ctx.sidecarFor(file),
    load: ctx.loaderFor(file),
    assets: ctx.assetsFor(file),
    fontScale,
    packs: o.pack,
    pack: readPack,
    iconsOverride: iconsFlag(o.icons),
    fonts,
    file: path.basename(file),
    view: o.view,
    step: o.step ? Number(o.step) || 1 : undefined,
    focus: focusFlag(o),
    ...(o.layer?.length ? { layers: o.layer.flatMap((l) => l.split(',')).map((l) => l.trim()).filter(Boolean) } : {}),
    ...(o.dim ? { layerMode: 'dim' as const } : {}),
    ...langOption(ctx),
  };
}

/** --all-steps: also steps nobody wrote; --no-steps: one slide per drawing; else a slide per written step. */
export const stepsFlag = (o: Pick<DocumentOptions, 'all-steps' | 'no-steps'>) => (o['no-steps'] ? false : o['all-steps'] ? true : undefined);

const aspects = ['16:9', '4:3'];
const pageSizes = ['fit', 'a4', 'a3'];

/** --aspect and --page: one of the values each takes, else a usage error that lists them. */
export function documentFlags(o: Pick<DocumentOptions, 'aspect' | 'page'>) {
  if (o.aspect != null && !aspects.includes(o.aspect)) throw new UsageError(`--aspect ${o.aspect} is not a slide shape carto makes; use one of: ${aspects.join(', ')}`);
  if (o.page != null && !pageSizes.includes(o.page)) throw new UsageError(`--page ${o.page} is not a page size carto makes; use one of: ${pageSizes.join(', ')}`);
}

/**
 * Slides and PDF pages, from one or many drawings; a brand theme carries over. `diagram`: the file a
 * single drawing comes from; `out`: the file written, whose name titles a PDF of several drawings.
 */
export async function document(ctx: Ctx, o: DocumentOptions, format: 'pptx' | 'pdf', drawings: Drawing[], theme: RenderResult['theme'], diagram?: string, out?: string): Promise<Uint8Array> {
  const th = theme ?? (o.theme === 'dark' ? 'dark' : 'light');
  if (format === 'pptx') {
    const slides: SlideText[] = [];
    const aspect = o.aspect === '4:3' ? '4:3' : '16:9';
    const template = templateFlags(ctx, o, theme, diagram);
    const data = await toPptx(drawings, { theme: th, aspect, font: o.font, title: o.title, subtitle: o.subtitle, steps: stepsFlag(o), rasterize: (svg, w) => iconPng(svg, w), onWarning: (w) => ctx.error(`${ctx.yellow(t('warning'))}  ${w}`), onSlide: (s) => slides.push(s), ...template });
    smallSlides(ctx, slides, template.template ? undefined : aspect, drawings.length === 1 ? (diagram ?? out) : (out ?? diagram));
    return data;
  }
  const page = o.page === 'a4' || o.page === 'a3' ? o.page : 'fit';
  // A PDF of several drawings is not the first one's: its title is the deck's, or the file's name.
  const title = o.title ?? (drawings.length > 1 && out && out !== '-' ? readableName(out) : undefined);
  return toPdf(drawings, { theme: th, page, fonts: interTtf(), families: themeTtf(typeof th === 'object' ? th : themes[th]), title, steps: stepsFlag(o) });
}

/** "architecture-review.pdf" as a title: "Architecture review". */
const readableName = (file: string) => {
  const words = path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Diagrams';
};

/**
 * The slides of a deck whose smallest text is under SLIDE_MIN_PT, as carto validate says it of one
 * drawing: a warning per drawing (its step slides share its layout), on standard error. `aspect`:
 * our own slides; undefined for a template's.
 */
function smallSlides(ctx: Ctx, slides: SlideText[], aspect: string | undefined, file: string | undefined) {
  const byTitle = new Map<string, SlideText[]>();
  for (const s of slides.filter((x) => x.smallestPt < SLIDE_MIN_PT)) byTitle.set(s.title ?? '', [...(byTitle.get(s.title ?? '') ?? []), s]);
  const page = aspect ? `${aspect} slide` : 'slide of the template';
  const advice = aspect === '4:3' ? 'a 16:9 slide (--aspect 16:9) gives it more room, or split it into views' : aspect ? 'split it into views, or let it wrap (aspect: 16:9)' : 'a layout with more room (--layout), or split it into views';
  for (const [title, list] of byTitle) {
    const pt = Math.min(...list.map((s) => s.smallestPt));
    const n = list.map((s) => s.slide);
    const where = n.length === 1 ? `slide ${n[0]}` : `slides ${n[0]}–${n.at(-1)}`;
    ctx.error(`${file && file !== '-' ? `${file}  ` : ''}${ctx.yellow(t('warning'))}  ${title ? `"${title}" (${where})` : where[0]!.toUpperCase() + where.slice(1)}: on a ${page} its smallest text is ${pt.toFixed(1)} pt, under ${SLIDE_MIN_PT} pt: ${advice}`);
  }
}

/**
 * --template customer.potx [--layout "Title Only"] [--keep-look] [--keep-slides], or the template a
 * brand theme names (pptx: template.potx, relative to the theme file): the deck is made in it.
 */
export function templateFlags(ctx: Ctx, o: Pick<DocumentOptions, 'template' | 'layout' | 'keep-look' | 'keep-slides'>, theme: RenderResult['theme'], diagram?: string): Pick<PptxOptions, 'template' | 'layout' | 'keepLook' | 'keepSlides' | 'onWarning'> {
  const fromTheme = !o.template && theme?.pptx;
  const file = o.template ?? (fromTheme && diagram ? path.join(path.dirname(diagram), fromTheme.template) : undefined);
  if (!file) {
    if (o.layout || o['keep-look'] || o['keep-slides']) ctx.error(`${ctx.yellow(t('warning'))}  ${t('--layout, --keep-look and --keep-slides go with --template: ignored')}`);
    return {};
  }
  if (!/\.(potx|pptx)$/i.test(file)) throw new UsageError(t('--template is a PowerPoint template, .potx or .pptx: {file}', { file }));
  const template = readTemplate(fs.readFileSync(file));
  const layout = o.layout ?? (fromTheme ? fromTheme.layout : undefined);
  return {
    template,
    ...(layout ? { layout } : {}),
    keepLook: !!o['keep-look'] || (!!fromTheme && !!fromTheme.keepLook),
    keepSlides: !!o['keep-slides'],
    onWarning: (w) => ctx.error(`${file}  ${ctx.yellow(t('warning'))}  ${w}`),
  };
}

/**
 * --stable: the note of each drawn view (how it was laid out and where things are) goes into the
 * sidecar, so the next render after an edit keeps what was there in place. Only written when it changed.
 */
export function noteLayout(ctx: Ctx, file: string, results: RenderResult[]) {
  const before = ctx.sidecarFor(file);
  let sidecar = before;
  for (const r of results) {
    const note = packLayout(r.placed?.memory, true);
    if (!r.svg || !note) continue;
    // A drawing of only some layers has a note of its own: the whole view's stays as the whole was drawn.
    const key = r.layers?.mode === 'only' && r.layers.active.length ? layerKey(r.view, r.layers.active) : r.view;
    const mine = viewPins(sidecar, key);
    if (sameLayoutNote(mine?.layout, note)) continue;
    sidecar = withViewPins(sidecar, key, { version: 1, ...mine, layout: note });
  }
  if (sidecar === before) return;
  writeSidecar(file, sidecar);
  ctx.log(`${file} → ${sidecarPath(file)} ${ctx.dim(t('layout noted'))}`);
}
