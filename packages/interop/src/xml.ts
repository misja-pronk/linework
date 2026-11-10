// A small XML reader: enough for draw.io files (elements, attributes, text, CDATA, comments).
// No namespaces, no DTD: what it cannot read, it reports with the place it stopped.
import { unescapeXml } from './text.ts';

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** The text directly inside, without the children's. */
  text: string;
}

// Sticky, so a long file is read in one pass.
const NAME = /<([^\s/>]+)/y;
const ATTR = /\s*(?:(\/?>)|([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'))/y;

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const top = () => stack[stack.length - 1]!;
  let i = 0;
  const fail = (what: string): never => {
    const line = source.slice(0, i).split('\n').length;
    throw new Error(`Not XML that can be read: ${what} (line ${line})`);
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
      stack.pop();
      i = end + 1;
    } else {
      NAME.lastIndex = i;
      const m = NAME.exec(source);
      if (!m) fail('a stray "<"');
      const node: XmlNode = { name: m![1]!, attrs: {}, children: [], text: '' };
      i = NAME.lastIndex;
      // Attributes, up to the end of the tag; a ">" inside a quoted value does not end it.
      for (;;) {
        ATTR.lastIndex = i;
        const a = ATTR.exec(source);
        if (!a) fail(`the tag <${node.name}> is not closed`);
        i = ATTR.lastIndex;
        if (a![1]) {
          top().children.push(node);
          if (a![1] === '>') stack.push(node);
          break;
        }
        node.attrs[a![2]!] = unescapeXml(a![3] ?? a![4] ?? '');
      }
    }
  }
  if (stack.length > 1) fail(`<${top().name}> is not closed`);
  return root;
}

/** Every element with this name, at any depth, in document order. */
export function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
