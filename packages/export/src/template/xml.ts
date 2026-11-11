// A small XML reader for the parts of a PowerPoint template: elements, attributes, text, and
// where each element sits in the source, so a part can be edited in place and the rest of it
// stays byte for byte what the template had. Prefixes are kept as written (p:sp, a:off).

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** The text directly inside, without the children's. */
  text: string;
  /** Offsets in the source: from "<" to just after the element's end. */
  start: number;
  end: number;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return NAMED[ref.toLowerCase()] ?? all;
  });
}

const NAME = /<([^\s/>]+)/y;
const ATTR = /\s*(?:(\/?>)|([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'))/y;

/** Throws on what is not well-formed: an unclosed or crossed element, a stray "<". */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '', start: 0, end: source.length };
  const stack = [root];
  const top = () => stack[stack.length - 1]!;
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`Not well-formed XML: ${what} (offset ${i})`);
  };
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) {
      top().text += unescapeXml(source.slice(i));
      break;
    }
    if (lt > i) top().text += unescapeXml(source.slice(i, lt));
    i = lt;
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i);
      i = end < 0 ? fail('a comment is not closed') : end + 3;
    } else if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i);
      if (end < 0) fail('a CDATA section is not closed');
      top().text += source.slice(i + 9, end);
      i = end + 3;
    } else if (source.startsWith('<?', i) || source.startsWith('<!', i)) {
      const end = source.indexOf('>', i);
      i = end < 0 ? fail('a declaration is not closed') : end + 1;
    } else if (source.startsWith('</', i)) {
      const end = source.indexOf('>', i);
      if (end < 0) fail('a closing tag is not closed');
      const name = source.slice(i + 2, end).trim();
      if (stack.length < 2 || top().name !== name) fail(`</${name}> closes nothing`);
      stack.pop()!.end = end + 1;
      i = end + 1;
    } else {
      NAME.lastIndex = i;
      const m = NAME.exec(source);
      if (!m) fail('a stray "<"');
      const node: XmlNode = { name: m![1]!, attrs: {}, children: [], text: '', start: i, end: i };
      i = NAME.lastIndex;
      for (;;) {
        ATTR.lastIndex = i;
        const a = ATTR.exec(source);
        if (!a) fail(`the tag <${node.name}> is not closed`);
        i = ATTR.lastIndex;
        if (a![1]) {
          top().children.push(node);
          if (a![1] === '>') stack.push(node);
          else node.end = i;
          break;
        }
        node.attrs[a![2]!] = unescapeXml(a![3] ?? a![4] ?? '');
      }
    }
  }
  if (stack.length > 1) fail(`<${top().name}> is not closed`);
  return root;
}

/** The first child with this name (`a:off`), or the first down a path (`p:cSld/p:bg`). */
export function child(node: XmlNode | undefined, path: string): XmlNode | undefined {
  let at = node;
  for (const name of path.split('/')) at = at?.children.find((c) => c.name === name);
  return at;
}

export const children = (node: XmlNode | undefined, name: string) => node?.children.filter((c) => c.name === name) ?? [];

/** Every element with this name, at any depth, in document order. */
export function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

/** The first element with this name at any depth. */
export function find(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  for (const c of node.children) {
    if (c.name === name) return c;
    const deep = find(c, name);
    if (deep) return deep;
  }
  return undefined;
}

/** All text inside, children's included (a:t runs of a paragraph). */
export function textOf(node: XmlNode): string {
  return node.text + node.children.map(textOf).join('');
}
