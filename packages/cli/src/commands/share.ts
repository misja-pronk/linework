// carto share <file.yaml>: a link that opens the diagram read-only in the web app, the diagram in its #fragment.
import fs from 'node:fs';
import path from 'node:path';
import { shareLink, SHARE_LIMIT } from '@cartography/core';
import type { ShareOptions } from '../args.ts';
import { t } from '../i18n.ts';
import type { Ctx } from '../io.ts';

export async function shareCommand(ctx: Ctx, files: string[], o: ShareOptions, usage: () => number): Promise<number> {
  const [f] = files;
  if (!f) return usage();
  const link = await shareLink({ yaml: fs.readFileSync(f, 'utf8'), name: path.basename(f), layout: ctx.sidecarFor(f) }, o.base ?? 'http://localhost:5178/');
  if (link.length > SHARE_LIMIT) {
    ctx.error(t('{file}: the link would be {size} kB, over the {limit} kB a link can safely carry. Share the file itself instead.', { file: f, size: Math.ceil(link.length / 1000), limit: SHARE_LIMIT / 1000 }));
    return 1;
  }
  ctx.log(link);
  return 0;
}
