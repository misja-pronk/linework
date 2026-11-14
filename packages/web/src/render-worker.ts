// Draws off the page's thread: a big drawing (the whole of a working canvas) can take a minute to lay
// out, and the editor goes on answering meanwhile. render-client.ts sends the work and takes it back.
import { render, type RenderOptions } from '@cartography/engine';
import { LANGS, type Lang } from '@cartography/i18n';
import { loaderOver, type Ask, type Answer } from './render-client.ts';

/** The files a loader reads, as last sent: sent again only when they change. */
const folders = new Map<number, ReadonlyMap<string, string>>();

self.onmessage = async (e: MessageEvent<Ask>) => {
  const { id, text, opts, files } = e.data;
  try {
    if (files?.entries) {
      folders.clear();
      folders.set(files.key, new Map(files.entries));
    }
    const folder = files && folders.get(files.key);
    const options: RenderOptions = { ...opts, ...(files && folder ? { load: loaderOver(files.base, (p) => folder.get(p), files.missing) } : {}) };
    const r = await render(text, options);
    // What does not cross to the page: the type (found again there by its id) and the titles of its
    // views in each language, worked out here.
    const { type, viewTitles, ...rest } = r;
    const titles = viewTitles ? (Object.fromEntries(LANGS.map((l) => [l, viewTitles(l)])) as Record<Lang, Record<string, string>>) : undefined;
    const answer: Answer = { id, result: rest, ...(type ? { type: type.id } : {}), ...(titles ? { titles } : {}) };
    self.postMessage(answer);
  } catch (err) {
    const answer: Answer = { id, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(answer);
  }
};
