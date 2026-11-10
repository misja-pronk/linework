// carto blocks: the block library from the command line (docs/blocks.md). Blocks are read from
// ./blocks (the project), the config folder's blocks/ (your own library) and the starters in
// examples/blocks; a name found earlier wins.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { findType, render } from '@cartography/engine';
import { blockDiagramText, blockText, checkValues, gather, idPrefix, insertBlock, mergeLibraries, readBlocks, slug, BLOCK_NAME, BLOCK_SUFFIX, type Listed } from '@cartography/blocks';
import { configDir } from './packs.ts';
import { toPng } from './png.ts';

export interface BlocksFlags {
  out?: string;
  from?: string;
  select?: string;
  into?: string;
  param?: string[];
  title?: string;
  user?: boolean;
  json?: boolean;
}

const starterDir = () => decodeURIComponent(new URL('../../../examples/blocks/', import.meta.url).pathname);
export const userBlocksDir = () => path.join(configDir(), 'blocks');

function readDir(dir: string): [string, string][] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(BLOCK_SUFFIX))
    .map((f) => [path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8')]);
}

/** Every block within reach: the project's, your own, the starters. */
export function library(cwd = process.cwd()): Listed[] {
  return mergeLibraries(readBlocks(readDir(path.join(cwd, 'blocks')), 'folder', findType), readBlocks(readDir(userBlocksDir()), 'library', findType), readBlocks(readDir(starterDir()), 'starter', findType));
}

function find(name: string): Listed {
  const all = library();
  const hit = all.find((l) => l.name === name) ?? (fs.existsSync(name) ? readBlocks([[name, fs.readFileSync(name, 'utf8')]], 'folder', findType)[0] : undefined);
  if (!hit) throw new Error(`No block "${name}". Blocks: ${all.map((l) => l.name).join(', ') || 'none'} (carto blocks list)`);
  if (!hit.block) throw new Error(`${hit.file}: ${hit.problems.map((p) => p.message).join('; ')}`);
  return hit;
}

/** --param k=v, given more than once. */
function params(list: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of list) {
    const i = p.indexOf('=');
    if (i < 1) throw new Error(`--param takes key=value, not "${p}"`);
    out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
}

const where = { folder: './blocks', library: 'your library', starter: 'starter' } as const;

export async function blocksCommand(args: string[], f: BlocksFlags, help: string): Promise<number> {
  const [sub, ...rest] = args;
  try {
    switch (sub) {
      case 'list':
      case undefined: {
        const all = library();
        if (f.json) return console.log(JSON.stringify(all.map((l) => ({ name: l.name, source: l.source, file: l.file, type: l.block?.type, title: l.block?.title, tags: l.block?.tags, params: l.block?.params, hash: l.block?.hash, problems: l.problems })), null, 2)), 0;
        if (!all.length) return console.log(`No blocks yet. Make one: carto blocks new <name> --from file.yaml --select a,b`), 0;
        const w = Math.max(...all.map((l) => l.name.length));
        for (const l of all) {
          const errors = l.problems.filter((p) => p.severity === 'error').length;
          console.log(`${l.name.padEnd(w)}  ${(l.block?.type ?? '?').padEnd(10)} ${l.block?.title ?? ''}${l.block?.params.length ? `  (${l.block.params.map((p) => p.name).join(', ')})` : ''}  [${where[l.source]}]${errors ? `  ${errors} problem${errors === 1 ? '' : 's'}` : ''}`);
        }
        return 0;
      }
      case 'show': {
        const [name] = rest;
        if (!name) return console.error(help), 1;
        const l = find(name);
        const b = l.block!;
        const values = params(f.param);
        console.log(`${b.title}  (${b.type}, ${where[l.source]}: ${l.file})`);
        if (b.description) console.log(b.description);
        if (b.tags.length) console.log(`tags: ${b.tags.join(', ')}`);
        for (const p of b.params) console.log(`  \${${p.name}}  default ${JSON.stringify(p.default)}${p.label ? `  ${p.label}` : ''}`);
        for (const p of l.problems) console.log(`${p.severity}: ${p.message}`);
        const text = blockDiagramText(b, values);
        if (f.out) {
          const r = await render(text, { fonts: 'none' });
          if (!r.svg) return console.error(r.diagnostics.map((d) => d.message).join('\n')), 1;
          fs.writeFileSync(f.out, /\.png$/i.test(f.out) ? toPng(r.svg, 2) : r.svg);
          console.error(`${name} → ${f.out}`);
        } else console.log(`\n${text}`);
        return l.problems.some((p) => p.severity === 'error') ? 1 : 0;
      }
      case 'new': {
        const [name] = rest;
        if (!name || !f.from || !f.select) return console.error(help), 1;
        if (!BLOCK_NAME.test(name)) throw new Error(`A block name is lower case letters, digits and -: ${slug(name)}?`);
        const text = fs.readFileSync(f.from, 'utf8');
        const data = parse(text) as Record<string, unknown>;
        const type = findType(String(data?.type));
        if (!type) throw new Error(`${f.from}: unknown type ${String(data?.type)}`);
        const ids = f.select.split(',').map((s) => s.trim()).filter(Boolean);
        const paths = ids.map((id) => {
          const c = Object.keys(data).find((k) => data[k] && typeof data[k] === 'object' && !Array.isArray(data[k]) && Object.hasOwn(data[k] as object, id));
          if (!c) throw new Error(`${f.from}: nothing called ${id}`);
          return [c, id];
        });
        const sel = gather(data, type, paths);
        // Where they are drawn now, so an insert by dragging keeps them as they stand.
        const r = await render(text, { fonts: 'none', load: (rel) => fs.readFileSync(path.resolve(path.dirname(f.from!), rel), 'utf8') });
        const box = (m: Map<string, { x: number; y: number }> | undefined) => Object.fromEntries([...(m ?? [])].map(([id, b]) => [id, { x: b.x, y: b.y }]));
        const out = blockText(type, sel, { name, title: f.title ?? name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), prefix: idPrefix(sel.entries.map((e) => e.id)), positions: { nodes: box(r.placed?.nodes), groups: box(r.placed?.groups) } });
        const dir = f.user ? userBlocksDir() : path.join(process.cwd(), 'blocks');
        const file = f.out ?? path.join(dir, `${name}${BLOCK_SUFFIX}`);
        if (fs.existsSync(file) && !f.out) console.error(`${file} is there: replaced (instances say the old version until you update them)`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, out.text);
        console.error(`${sel.entries.length} entries and ${sel.items.length} lines → ${file}${out.block.params.length ? `  params: ${out.block.params.map((p) => `${p.name}=${p.default}`).join(', ')}` : ''}`);
        for (const c of sel.cut) console.error(`left out ${c} (outside the block)`);
        return 0;
      }
      case 'insert': {
        const [name, ...more] = rest;
        const file = more[0] === 'into' ? more[1] : more[0];
        if (!name || !file) return console.error(help), 1;
        const b = find(name).block!;
        const text = fs.readFileSync(file, 'utf8');
        const type = findType(String((parse(text) as { type?: unknown })?.type));
        if (!type) throw new Error(`${file}: no diagram type`);
        const values = params(f.param);
        for (const k of Object.keys(values)) if (!b.params.some((p) => p.name === k)) throw new Error(`${name} has no parameter ${k}: ${b.params.map((p) => p.name).join(', ') || 'none'}`);
        const bad = Object.entries(checkValues(b, values));
        if (bad.length) throw new Error(bad.map(([k, why]) => `--param ${k}: ${why}`).join('; '));
        let into: { collection: string; id: string } | undefined;
        if (f.into) {
          const data = parse(text) as Record<string, Record<string, unknown> | undefined>;
          const c = ['groups', ...Object.keys(data)].find((k) => data[k] && typeof data[k] === 'object' && !Array.isArray(data[k]) && Object.hasOwn(data[k]!, f.into!));
          if (!c) throw new Error(`${file}: no group ${f.into}`);
          into = { collection: c, id: f.into };
        }
        const r = insertBlock(text, type, b, { values, into });
        if ('error' in r) throw new Error(r.error);
        const target = f.out ?? file;
        if (target === '-') process.stdout.write(r.text);
        else fs.writeFileSync(target, r.text);
        const renamed = [...r.ids].filter(([a, z]) => a !== z).length;
        console.error(`${b.name} #${r.instance.no} → ${target}: ${r.paths.length} entries and lines${renamed ? `, ids with ${[...r.ids.values()][0]!.slice([...r.ids.keys()][0]!.length)} (the others were taken)` : ''}${into ? `, in ${into.id}` : ''}`);
        return 0;
      }
      default:
        return console.error(help), 1;
    }
  } catch (e) {
    console.error(`carto blocks: ${(e as Error).message}`);
    return 1;
  }
}
