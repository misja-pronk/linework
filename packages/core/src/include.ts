// `include:` — a diagram pulls in other YAML files (relative to it, through the same loader as data
// contracts, so CLI watch, web folders and bundled examples all follow them). Maps such as nodes and
// groups merge key by key, lists such as edges append; the diagram's own entries come first, so their
// ids and paths stay what the editor knows. Problems in an included file point at its include entry.
import { emptyCatalogue, modelKeys, readModel, type Catalogue } from './catalogue.ts';
import { parseSource, validate } from './source.ts';
import { withEach } from './each.ts';
import type { Path } from './model.ts';

export interface Composed {
  /** The diagram with included entries merged in and the model keys taken out. */
  data: Record<string, unknown>;
  catalogue: Catalogue;
  /** Included files, relative to the diagram, in load order. */
  files: string[];
  /** For an entry that came from another file (['nodes', 'web'], ['edges', 7]): its include entry and file. */
  origin(path: Path): { at: Path; file: string } | undefined;
}

export interface ComposeOptions {
  /** The model keys in play: a type may define one of them as its own (an ERD's relations). */
  keys?: readonly string[];
  load?: (file: string) => string;
  /** Schema for an included file of this type ('model' for model files). */
  schemaOf(type: string): object | undefined;
  report(path: Path, message: string, severity?: 'error' | 'warning'): void;
  /** The diagram's own file name, so an include back to it is seen as a cycle. */
  self?: string;
  /** The diagram's text, the other way to recognise an include of itself. */
  text?: string;
}

// What a file says about itself: an included file's title, direction, focus or steps stay its own.
const SCALARS = new Set(['type', 'title', 'subtitle', 'direction', 'focus', 'steps']);
// How a file looks and the language of its own words: the diagram that includes it decides those for
// the whole drawing, so an included file may say them (the Dutch editor writes lang: nl) and they are passed over.
const LOOK = ['lang', 'theme', 'icons', 'aspect'];

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function includesOf(data: Record<string, unknown>): string[] {
  const v = data.include;
  return typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** "a/b/../c.yaml" → "a/c.yaml"; leading ".." stay (the loader resolves them against the diagram). */
export function joinPath(dir: string, rel: string): string {
  const parts: string[] = [];
  for (const seg of `${dir ? dir + '/' : ''}${rel}`.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (file: string) => file.split('/').slice(0, -1).join('/');

export function compose(main: Record<string, unknown>, o: ComposeOptions): Composed {
  const MODEL = new Set<string>(o.keys ?? modelKeys);
  const mainType = String(main.type);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(main)) if (!MODEL.has(k)) data[k] = v;
  const catalogue = emptyCatalogue();
  const own = (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).filter(([k]) => MODEL.has(k)));
  readModel(own(main), catalogue, (p) => p, o.report);

  const owner = new Map<string, string>();
  for (const [coll, v] of Object.entries(data)) if (isMap(v) && !SCALARS.has(coll)) for (const id of Object.keys(v)) owner.set(`${coll}\0${id}`, 'this file');
  const origins = new Map<string, { at: Path; file: string }>();
  const files: string[] = [];
  const seen = new Set<string>();

  const visit = (rel: string, from: string, stack: string[], at: Path) => {
    const file = joinPath(from, rel);
    if (stack.includes(file)) return o.report(at, `Include cycle: ${[...stack, file].join(' → ')}`);
    // Reached again through another file: its entries are in already.
    if (seen.has(file)) return;
    seen.add(file);
    if (!o.load) return o.report(at, `Cannot read ${file} here: includes need the diagram's folder`);
    let text: string;
    try {
      text = o.load(file);
    } catch {
      return o.report(at, `Cannot read ${file}`);
    }
    if (o.text != null && text === o.text) return o.report(at, `Include cycle: ${file} is this diagram`);
    files.push(file);
    // Its own each: is written out in it, as when it is drawn itself.
    const { source: src, problems: eachProblems } = withEach(parseSource(text));
    const where = (line?: number) => (line ? `${file}:${line}` : file);
    if (src.data === undefined) {
      const d = src.diagnostics.find((x) => x.severity === 'error');
      return o.report(at, `${where(d?.line)}: ${d?.message ?? 'cannot be read'}`);
    }
    const wrong = eachProblems.filter((d) => d.severity === 'error');
    for (const d of wrong.slice(0, 3)) o.report(at, `${where(d.line)}: ${d.message}`);
    if (wrong.length) return;
    if (!isMap(src.data)) return o.report(at, `${file} is not a diagram or model`);
    const part = Object.fromEntries(Object.entries(src.data).filter(([k]) => !LOOK.includes(k)));
    const type = part.type == null ? mainType : String(part.type);
    if (type !== 'model' && type !== mainType)
      return o.report(at, `${file} is a ${type} diagram: include a type: model file or another ${mainType} diagram`);
    if (mainType === 'model' && type !== 'model') return o.report(at, `A model can only include other models, not ${file}`);
    const schema = o.schemaOf(type);
    if (schema) {
      const problems = validate({ ...src, data: { ...part, type } }, schema);
      for (const d of problems.slice(0, 3)) o.report(at, `${where(d.line)}: ${d.message}`);
      if (problems.length) return;
    }

    // "#view" in that file is a view of that file; other paths are relative to it.
    const move = (t: string) => (t.startsWith('#') ? file + t : joinPath(dirOf(file), t));
    // Elements point at their include entry plus the file: no editor takes that for an entry it can change here.
    readModel(own(part), catalogue, () => [...at, file], o.report, file, move);
    for (const [coll, v] of Object.entries(part)) {
      if (SCALARS.has(coll) || MODEL.has(coll)) continue;
      const mine = data[coll];
      if (Array.isArray(v)) {
        if (mine != null && !Array.isArray(mine)) {
          o.report(at, `"${coll}" in ${file} is a list, here it is not`);
          continue;
        }
        const list = (data[coll] = [...((mine as unknown[]) ?? []), ...v]);
        for (let i = list.length - v.length; i < list.length; i++) origins.set(`${coll}\0${i}`, { at, file });
      } else if (isMap(v)) {
        if (mine != null && !isMap(mine)) {
          o.report(at, `"${coll}" in ${file} is a map, here it is not`);
          continue;
        }
        const map = (data[coll] = { ...((mine as Record<string, unknown>) ?? {}) });
        for (const [id, entry] of Object.entries(v)) {
          const key = `${coll}\0${id}`;
          if (owner.has(key)) {
            o.report(at, `"${id}" in ${file} is already in ${coll} of ${owner.get(key)}`);
            continue;
          }
          owner.set(key, file);
          origins.set(key, { at, file });
          map[id] = entry;
        }
      }
    }
    for (const sub of includesOf(part)) visit(sub, dirOf(file), [...stack, file], at);
  };

  for (const [i, rel] of includesOf(main).entries()) visit(rel, '', o.self ? [o.self] : [], ['include', i]);

  return {
    data,
    catalogue,
    files,
    origin: (path) => (path.length >= 2 ? origins.get(`${path[0]}\0${path[1]}`) : undefined),
  };
}
