// Checks for a catalog, run from the tests: every Dutch message has the placeholders and plural
// forms of its English, and every id is still used in the code it is for. Node only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { english, type Catalog } from './index.ts';

const holes = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort().join(' ');

/** Messages whose Dutch lacks or adds a placeholder, or has another number of plural forms. */
export function badMessages(nl: Catalog): string[] {
  const bad: string[] = [];
  for (const [id, text] of Object.entries(nl)) {
    const en = english(id);
    if (!text.trim()) bad.push(`${id}: empty`);
    else if (en.split('|').length !== text.split('|').length) bad.push(`${id}: plural forms differ`);
    else if (holes(en) !== holes(text)) bad.push(`${id}: placeholders ${holes(en) || 'none'} → ${holes(text) || 'none'}`);
  }
  return bad;
}

/** The text of every .ts/.tsx file under these folders, catalogs and tests left out. */
export function sourceText(dirs: string[], skip: (file: string) => boolean = () => false): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      if (f === 'node_modules' || f === 'generated') continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs)$/.test(f) && !skip(p)) out.push(readFileSync(p, 'utf8'));
    }
  };
  for (const d of dirs) walk(d);
  return out.join('\n');
}

/** Ids no code says any more, as a quoted string. A catalog for text known at run time passes `dynamic` for those. */
export function unusedIds(nl: Catalog, source: string, dynamic: (id: string) => boolean = () => false): string[] {
  const quoted = (id: string) => [`'${id}'`, `"${id}"`, `\`${id}\``].some((q) => source.includes(q)) || source.includes(`'${id.replace(/'/g, "\\'")}'`);
  return Object.keys(nl).filter((id) => !dynamic(id) && !quoted(id));
}
