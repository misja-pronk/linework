// carto describe <file.yaml>: the diagram in plain words, as text, Markdown or HTML.
import fs from 'node:fs';
import path from 'node:path';
import type { DescribeOptions } from '../args.ts';
import { describeFile } from '../describe.ts';
import { optionsFor } from '../draw.ts';
import { t } from '../i18n.ts';
import { UsageError, type Ctx } from '../io.ts';

export async function describeCommand(ctx: Ctx, files: string[], o: DescribeOptions, usage: () => number): Promise<number> {
  const [f] = files;
  if (!f || files.length > 1) return usage();
  if (!fs.existsSync(f)) return (ctx.error(t('{file}: no such file', { file: f })), 1);
  const ext = o.out && o.out !== '-' ? path.extname(o.out).slice(1).toLowerCase() : '';
  const asked = o.format === 'markdown' ? 'md' : o.format;
  if (asked !== 'svg' && !['text', 'md', 'html'].includes(asked)) throw new UsageError(`--format ${o.format}: carto describe writes text, md or html`);
  const format = asked === 'text' || asked === 'md' || asked === 'html' ? asked : ext === 'md' || ext === 'markdown' ? 'md' : ext === 'html' || ext === 'htm' ? 'html' : 'text';
  const r = await describeFile(f, { view: o.view, allViews: o['all-views'], format, options: optionsFor(ctx, o, f, 'none') });
  for (const p of r.problems) ctx.error(`${f}  ${ctx.red(t('error'))}  ${p}`);
  if (!r.ok) return 1;
  if (!o.out || o.out === '-') ctx.write(r.text);
  else {
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, r.text);
    ctx.error(`${f} → ${o.out}`);
  }
  return 0;
}
