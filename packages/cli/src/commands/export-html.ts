// carto export-html <file.yaml|folder> (also: carto export --to html): one HTML file to send.
import fs from 'node:fs';
import path from 'node:path';
import type { ExportHtmlOptions } from '../args.ts';
import { iconsFlag, langOption, themeFlag } from '../draw.ts';
import { fontScale } from '../fonts.ts';
import { t } from '../i18n.ts';
import type { Ctx } from '../io.ts';
import { readPack } from '../packs.ts';

export async function exportHtmlCommand(ctx: Ctx, files: string[], o: ExportHtmlOptions, usage: () => number): Promise<number> {
  const [f] = files;
  if (!f || files.length > 1) return usage();
  if (!fs.existsSync(f)) return (ctx.error(t('{file}: no such file or folder', { file: f })), 1);
  const forced = themeFlag(ctx, o.theme);
  if (forced === false) return 1;
  const { exportHtmlFile } = await import('../html-export.ts');
  const r = await exportHtmlFile(f, o.out, { title: o.title, allSteps: o['all-steps'], render: { themeOverride: forced, packs: o.pack, pack: readPack, iconsOverride: iconsFlag(o.icons), fontScale, ...langOption(ctx) } });
  for (const p of r.problems) ctx.error(`${path.join(r.root, p.file)}${p.line ? `:${p.line}` : ''}  ${ctx.red(t('error'))}  ${p.message}`);
  if (!r.stats.drawings) return (ctx.error(t('{file}: nothing to draw', { file: f })), 1);
  const s = r.stats;
  const stdout = r.file === '-';
  if (stdout) ctx.write(r.html);
  (stdout ? ctx.error : ctx.log)(`${f} → ${stdout ? t('standard output') : r.file} ${ctx.dim(`${t('{count} drawing|{count} drawings', { count: s.drawings })}${s.steps ? `, ${t('{count} step|{count} steps', { count: s.steps })}` : ''}, ${t('{count} element|{count} elements', { count: s.elements })}, ${(s.bytes / 1024).toFixed(0)} kB`)}`);
  return r.problems.length ? 1 : 0;
}
