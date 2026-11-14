// linework watch <file.yaml…>: render, then again on every save of the diagram, its sidecar or what it includes.
import fs from 'node:fs';
import path from 'node:path';
import type { RenderOptions } from '../args.ts';
import { themeFlag } from '../draw.ts';
import { t } from '../i18n.ts';
import type { Ctx } from '../io.ts';
import { renderFile, renderFlags, type Job } from './render.ts';

export async function watchCommand(ctx: Ctx, files: string[], o: RenderOptions): Promise<number> {
  renderFlags(o);
  const forced = themeFlag(ctx, o.theme);
  if (forced === false) return 1;
  const job: Job = { o, command: 'watch', count: files.length, forced };
  for (const f of files) {
    let timer: NodeJS.Timeout | undefined;
    const followed = new Set<string>();
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void renderFile(ctx, job, f).then(follow), 80);
    };
    // Contract files can be added while watching, so follow whatever the last render read.
    const follow = () => {
      for (const p of ctx.loaded.get(f) ?? [])
        if (!followed.has(p) && fs.existsSync(p)) {
          followed.add(p);
          fs.watch(p, again);
        }
    };
    await renderFile(ctx, job, f);
    follow();
    fs.watch(path.dirname(f), (_, name) => {
      if (name && f.endsWith(name.replace(/\.layout\.json$/, path.extname(f)))) again();
    });
  }
  ctx.log(ctx.dim(t('watching… Ctrl+C to stop')));
  return new Promise(() => {});
}
