// linework serve [folder] [--port 4317]: the web editor for a folder, with an MCP endpoint for the user's own AI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServeOptions } from '../args.ts';
import { t } from '../i18n.ts';
import { isFolder, UsageError, type Ctx } from '../io.ts';

/**
 * The built web app: web/ next to the bundled linework.mjs (pnpm build copies it there), else
 * packages/web/dist in a clone (pnpm web:build). Undefined when neither is built.
 */
export function webApp(): string | undefined {
  const candidates = [new URL('./web/', import.meta.url), new URL('../../../web/dist/', import.meta.url)].map((u) => fileURLToPath(u));
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));
}

export async function serveCommand(ctx: Ctx, files: string[], o: ServeOptions, usage: () => number): Promise<number> {
  const { bold, dim } = ctx;
  if (files.length > 1) return usage();
  const root = path.resolve(files[0] ?? '.');
  if (!isFolder(root)) return (ctx.error(t('{file}: not a folder', { file: files[0] ?? '.' })), 1);
  const port = o.port === undefined ? 4317 : Number(o.port);
  if (!(Number.isInteger(port) && port >= 0 && port < 65536)) throw new UsageError(t('--port takes a number, e.g. --port 4317'));
  const app = webApp();
  if (!app) return (ctx.error(t('The web app is not built yet: run pnpm web:build first')), 1);
  const { serve } = await import('../serve.ts');
  let s: Awaited<ReturnType<typeof serve>>;
  try {
    s = await serve({ root, port, app, log: (l) => ctx.error(dim(l)) });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') return (ctx.error(t('Port {port} is in use: pick another with --port', { port })), 1);
    throw e;
  }
  ctx.log(`${bold(t('Linework for {folder}', { folder: root }))}
  ${t('Editor')}  ${s.url}/
  MCP     ${s.url}/mcp
`);
  ctx.log(dim(t('Connect your AI (once; the token stays the same):')));
  ctx.log(`  claude mcp add --transport http linework ${s.url}/mcp --header "Authorization: Bearer ${s.token}"
`);
  ctx.log(dim(t('Ctrl+C to stop')));
  const stop = () => (s.close(), process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return new Promise(() => {});
}
