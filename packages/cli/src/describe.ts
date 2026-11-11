// `carto describe`: a diagram in words, as text, Markdown or HTML; and the PNG that carries them.
import fs from 'node:fs';
import path from 'node:path';
import { describe, pngWithText, toHtml, toMarkdown, toText, type Description } from '@cartography/describe';
import { render, type RenderOptions, type RenderResult } from '@cartography/engine';

/** The words of a drawing, as render gave it. */
export const told = (r: RenderResult, file: string): Description => describe({ ...r, name: path.basename(file) });

/** A PNG that carries its title and description (PNG text chunks). */
export async function describedPng(r: RenderResult, file: string, bytes: Uint8Array): Promise<Uint8Array> {
  const d = told(r, file);
  return pngWithText(bytes, { title: d.title, description: toText(d, { title: false }).trim() });
}

/** carto describe: text by default, Markdown or HTML by -o's extension or --format. */
export async function describeFile(file: string, o: { view?: string; allViews?: boolean; format: 'text' | 'md' | 'html'; options: RenderOptions }): Promise<{ text: string; ok: boolean; problems: string[] }> {
  const source = fs.readFileSync(file, 'utf8');
  const first = await render(source, { ...o.options, fonts: 'none', view: o.view });
  const runs = [first, ...(o.allViews && !o.view ? await Promise.all((first.views ?? []).filter((v) => v.name !== first.view).map((v) => render(source, { ...o.options, fonts: 'none', view: v.name }))) : [])].filter((r) => r.graph && !r.empty);
  const problems = [first, ...runs].flatMap((r) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message));
  const parts = runs.map((r, i) => {
    const d = told(r, file);
    if (o.format === 'md') return toMarkdown(d, { level: i ? 2 : 1 });
    if (o.format === 'html') return toHtml(d, { level: i ? 2 : 1 });
    return toText(d);
  });
  return { text: parts.join(o.format === 'html' ? '\n' : '\n'), ok: !problems.length && !!runs.length, problems: [...new Set(problems)] };
}
