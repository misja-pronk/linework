// Small text helpers shared by the importers: ids, labels and YAML output that reads like hand-written YAML.

/** A Cartography id ([A-Za-z0-9_-]) from any Mermaid id or title. */
export function slug(s: string): string {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return out || 'item';
}

/** Hands out unique ids, the same one each time for the same source id. */
export class Ids {
  private bySource = new Map<string, string>();
  private used = new Set<string>();
  get(source: string, prefer = slug(source)): string {
    let id = this.bySource.get(source);
    if (id) return id;
    id = prefer;
    for (let n = 2; this.used.has(id); n++) id = `${prefer}-${n}`;
    this.used.add(id);
    this.bySource.set(source, id);
    return id;
  }
  has(source: string) {
    return this.bySource.has(source);
  }
}

/** Mermaid label text → plain text: quotes, <br>, html, markdown, fa: icons and #entities out. */
export function cleanLabel(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  if (s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1);
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\bfa[bsrl]?:fa-[\w-]+\s*/g, '')
    .replace(/#quot;/g, '"')
    .replace(/#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\*\*|__|\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The fa: icon named in a label (fa:fa-database → "database"), a hint for the kind. */
export function faIcon(raw: string): string | undefined {
  return /\bfa[bsrl]?:fa-([\w-]+)/.exec(raw)?.[1]?.replace(/-/g, ' ');
}

const RESERVED = /^(true|false|yes|no|on|off|y|n|null|~|[-+]?(\d[\d_]*(\.\d*)?|\.\d+)(e[-+]?\d+)?|0x[0-9a-f]+|\.inf|\.nan)$/i;

/** A YAML scalar, plain when that is safe inside flow maps and after "key: ", quoted otherwise. */
export function scalar(s: string): string {
  if (/^[A-Za-z_(][\w .\/()+'&-]*$/.test(s) && !/\s$/.test(s) && !RESERVED.test(s)) return s;
  return JSON.stringify(s);
}

/** `{ kind: database, label: Orders }` with values in the given order, undefined left out. */
export function flow(entries: [string, string | undefined][]): string {
  const parts = entries.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${scalar(v!)}`);
  return `{ ${parts.join(', ')} }`;
}

export class Warnings {
  list: string[] = [];
  private once = new Set<string>();
  add(message: string) {
    this.list.push(message);
  }
  /** One message per topic, however often it occurs. */
  onceFor(topic: string, message: string) {
    if (this.once.has(topic)) return;
    this.once.add(topic);
    this.list.push(message);
  }
}
