// carto deck <file.yaml…> -o deck.pptx|deck.pdf: several diagrams, one file, a slide or page each in the order given.
import fs from 'node:fs';
import path from 'node:path';
import { render, type RenderResult } from '@cartography/engine';
import { pages, type Drawing } from '@cartography/export';
import type { DeckOptions } from '../args.ts';
import { document, optionsFor, stepsFlag } from '../draw.ts';
import { t } from '../i18n.ts';
import type { Ctx } from '../io.ts';

export async function deckCommand(ctx: Ctx, files: string[], o: DeckOptions, usage: () => number): Promise<number> {
  if (!files.length) return usage();
  const format = o.out?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'pptx';
  if (!o.out || !/\.(pptx|pdf)$/i.test(o.out)) {
    ctx.error(t('carto deck needs -o <file>.pptx or -o <file>.pdf'));
    return 1;
  }
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
    if (r.graph) drawings.push({ ...r, name: path.basename(f) });
  }
  if (!drawings.length) return 1;
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  fs.writeFileSync(o.out, await document(ctx, o, format, drawings, theme, files[0]));
  const count = pages(drawings, stepsFlag(o)).length;
  ctx.log(`${t('{count} diagram|{count} diagrams', { count: drawings.length })}${count > drawings.length ? `, ${format === 'pdf' ? t('{count} page|{count} pages', { count }) : t('{count} slide|{count} slides', { count })}` : ''} → ${o.out}`);
  return ok ? 0 : 1;
}
