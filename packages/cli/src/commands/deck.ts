// carto deck <file.yaml…> -o deck.pptx|deck.pdf: several diagrams, one file, a slide or page each in the order given.
import fs from 'node:fs';
import path from 'node:path';
import { render, type RenderResult } from '@cartography/engine';
import { pages, type Drawing } from '@cartography/export';
import type { DeckOptions } from '../args.ts';
import { document, documentFlags, optionsFor, stepsFlag } from '../draw.ts';
import { t } from '../i18n.ts';
import type { Ctx } from '../io.ts';

export async function deckCommand(ctx: Ctx, files: string[], o: DeckOptions, usage: () => number): Promise<number> {
  if (!files.length) return usage();
  const format = o.out?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'pptx';
  if (!o.out || !/\.(pptx|pdf)$/i.test(o.out)) {
    ctx.error(t('carto deck needs -o <file>.pptx or -o <file>.pdf'));
    return 1;
  }
  documentFlags(o);
  const drawings: Drawing[] = [];
  let theme: RenderResult['theme'];
  let ok = true;
  for (const f of files) {
    const drawn = await render(fs.readFileSync(f, 'utf8'), optionsFor(ctx, o, f, 'none'));
    ctx.report(f, drawn.diagnostics);
    // A deck tells every step; --step is for one drawing.
    const r = { ...drawn, step: undefined };
    theme ??= r.theme;
    if (!r.graph || r.diagnostics.some((d) => d.severity === 'error')) ok = false;
    // A drawing read scrolling (a whole sequence) is too small for a slide: its other views (its phases) present it, in a deck of slides.
    // A canvas (present: views) is presented by all of its views, the first one (drawn already) among them.
    const by = r.canvas && o.view === undefined ? (r.views ?? []) : format === 'pptx' && r.scroll && !o.view ? (r.views ?? []).filter((v) => v.name !== (r.view ?? r.asWritten?.name)) : [];
    const views = by.length ? (await Promise.all(by.map((v) => (v.name === r.view ? r : render(fs.readFileSync(f, 'utf8'), { ...optionsFor(ctx, o, f, 'none'), view: v.name, step: undefined }))))).filter((v) => v.graph && !v.empty && !v.diagnostics.some((d) => d.severity === 'error')) : [];
    if (views.length) drawings.push(...views.map((v) => ({ ...v, name: path.basename(f) })));
    else if (r.graph) drawings.push({ ...r, name: path.basename(f) });
  }
  if (!drawings.length) return 1;
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  fs.writeFileSync(o.out, await document(ctx, o, format, drawings, theme, files[0], o.out));
  const count = pages(drawings, stepsFlag(o)).length;
  ctx.log(`${t('{count} diagram|{count} diagrams', { count: drawings.length })}${count > drawings.length ? `, ${format === 'pdf' ? t('{count} page|{count} pages', { count }) : t('{count} slide|{count} slides', { count })}` : ''} → ${o.out}`);
  return ok ? 0 : 1;
}
