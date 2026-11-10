// Writing YAML by hand, line by line, so a wizard's file reads like one a person wrote: flow maps on
// one line, comments where a choice was made. These helpers only quote what needs quoting.

type Value = string | number | boolean | undefined | null | Value[] | { [k: string]: Value };

/** A scalar, quoted when YAML would read it as something else (a number, yes/no, a key, a comment). */
export function scalar(v: string | number | boolean): string {
  if (typeof v !== 'string') return String(v);
  const plain = /^[A-Za-z_./(][\w .·/()&+'%-]*$/.test(v) && !/[ ]$/.test(v) && !/^(true|false|yes|no|on|off|null|y|n)$/i.test(v);
  return plain ? v : JSON.stringify(v);
}

/** A flow value: `{ kind: vnet, label: Hub }`, `[a, b]`; undefined entries are left out. */
export function flow(v: Value): string {
  if (Array.isArray(v)) return `[${v.filter((x) => x !== undefined).map(flow).join(', ')}]`;
  if (v && typeof v === 'object') {
    const parts = Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${scalar(k)}: ${flow(x)}`);
    return `{ ${parts.join(', ')} }`;
  }
  return v == null ? 'null' : scalar(v);
}

/** A line `id: { … }` at an indent. */
export const entry = (id: string, v: Value, indent = 2) => `${' '.repeat(indent)}${scalar(id)}: ${flow(v)}`;

/** An id from a name: lower case, words joined by dashes. */
export function slug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

/** Ids for a list of names, unique among themselves and against ids already taken. */
export function ids(list: string[], taken: Iterable<string> = []): string[] {
  const used = new Set(taken);
  return list.map((n) => {
    const base = slug(n);
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    return id;
  });
}

/** Comment lines, wrapped at about 100 characters. */
export function comment(text: string, indent = 0): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length > 96) out.push(line), (line = '');
    line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.map((l) => `${' '.repeat(indent)}# ${l}`);
}

/** Lines into a file: blank runs collapsed, one newline at the end. */
export const file = (lines: (string | false | undefined)[]) =>
  lines
    .filter((l): l is string => typeof l === 'string')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';

/** "1 subscription", "3 subscriptions". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
