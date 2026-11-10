// Links in the docs work in both places they are read: on GitHub, where a link is a path in the
// repository, and on the site, where the builder rewrites .md links (and ../examples/ to the gallery).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const docs = path.resolve(import.meta.dirname, '../..');
const pages = (dir = docs): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const abs = path.join(dir, d.name);
    if (['node_modules', 'dist', 'research', 'site'].includes(d.name)) return [];
    return d.isDirectory() ? pages(abs) : d.name.endsWith('.md') ? [abs] : [];
  });

describe('docs links', () => {
  it('point at files in the repository, never at pages only the site has', () => {
    const broken: string[] = [];
    for (const file of pages()) {
      const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target!)) continue;
        const p = path.resolve(path.dirname(file), decodeURI(target!.split('#')[0]!));
        if (!fs.existsSync(p)) broken.push(`${path.relative(docs, file)}: ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('puts the requirements on the site', () => {
    expect(fs.readFileSync(path.join(docs, 'site/src/build.ts'), 'utf8')).toContain("['requirements.md', 'Requirements']");
  });
});
