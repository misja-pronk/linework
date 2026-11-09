// The markdown-it plugin (VitePress, Eleventy, plain markdown-it): fenced ```cartography blocks and
// images that point at a .yaml file become drawings in the page.
import path from 'node:path';
import { diagramReference, fenceJob, imageJob, pageStyle, problemText, type Built, type CartographyOptions, type Job } from './core.ts';
import { buildSync } from './sync.ts';
import { toHtml } from './tree.ts';

export interface MarkdownItCartographyOptions extends CartographyOptions {
  /** The output is compiled as a Vue template (VitePress): marks the drawing so Vue leaves it alone. */
  vue?: boolean;
  /** Where warnings go. Default: console.warn. */
  warn?: (message: string) => void;
}

// The few parts of markdown-it used here, so the plugin needs no types from it.
interface Token {
  type: string;
  tag: string;
  info: string;
  content: string;
  map: [number, number] | null;
  level: number;
  block: boolean;
  hidden: boolean;
  children: Token[] | null;
  attrGet(name: string): string | null;
}
interface State {
  tokens: Token[];
  env?: Record<string, unknown>;
  Token: new (type: string, tag: string, nesting: number) => Token;
}
// Loose on purpose: markdown-it's own types differ between versions, and any of them fits this.
interface MarkdownIt {
  core: { ruler: { push(name: string, rule: (state: any) => void): void } };
}

const isSpace = (t: Token) => t.type === 'softbreak' || t.type === 'hardbreak' || (t.type === 'text' && !t.content.trim());

export default function markdownItCartography(md: MarkdownIt, options: MarkdownItCartographyOptions = {}): void {
  // The options that go to the worker with each diagram: plain data only.
  const { vue, warn = (m: string) => console.warn(m), ...plain } = options;
  const strict = plain.strict !== false;

  md.core.ruler.push('cartography', (state: State) => {
    const env = (state.env ??= {});
    const page = [env.path, env.filePath, env.relativePath].find((p): p is string => typeof p === 'string' && !!p);
    const dir = page ? path.dirname(path.resolve(page)) : process.cwd();
    const shown = page ? path.relative(process.cwd(), path.resolve(page)).split(path.sep).join('/') : 'markdown';

    const html = (content: string, from: Token): Token => {
      const t = new state.Token('html_block', '', 0);
      t.content = content + '\n';
      t.map = from.map;
      t.level = from.level;
      t.block = true;
      return t;
    };
    const draw = (job: Job, from: Token, fenced: boolean): Token[] => {
      let built: Built;
      try {
        built = buildSync(job);
      } catch (e) {
        throw new Error(`${shown}:${(from.map?.[0] ?? 0) + 1}: ${e instanceof Error ? e.message : String(e)}`);
      }
      const start = from.map?.[0] ?? 0;
      const errors: string[] = [];
      for (const p of built.problems) {
        // A problem in a fenced block is on a line of the markdown file; one in a diagram file is named with it.
        const text = fenced
          ? `${shown}:${start + 1 + (p.line ?? 0)}${p.line != null && p.column != null ? `:${p.column}` : ''}: ${p.message}`
          : `${shown}:${start + 1}: ${problemText(p)}`;
        if (p.severity === 'error' && strict) errors.push(text);
        else warn(text);
      }
      if (errors.length) throw new Error(errors.join('\n'));
      if (vue) built.figure.attrs['v-pre'] = '';
      const out = [html(toHtml(built.figure), from)];
      // The stylesheet is a block of its own, so VitePress lifts it out of the page like any <style>.
      if (built.ok && plain.pageStyle !== false && !env.cartographyStyle) {
        env.cartographyStyle = true;
        out.unshift(html(toHtml(pageStyle(plain)), from));
      }
      return out;
    };

    const tokens = state.tokens;
    const next: Token[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const job = token.type === 'fence' ? fenceJob(token.info, token.content, dir, plain) : undefined;
      if (job) {
        next.push(...draw(job, token, true));
        continue;
      }
      const diagramIn = (t: Token) => t.type === 'image' && !!diagramReference(t.attrGet('src') ?? '');
      if (token.type !== 'inline' || !token.children?.some(diagramIn)) {
        next.push(token);
        continue;
      }
      const open = tokens[i - 1];
      const close = tokens[i + 1];
      if (open?.type !== 'paragraph_open' || close?.type !== 'paragraph_close') {
        warn(`${shown}:${(token.map?.[0] ?? 0) + 1}: a diagram inside a heading or table is left as it is: give it a line of its own`);
        next.push(token);
        continue;
      }
      // A drawing is a block: the text around it in the same paragraph stays, as paragraphs before and after.
      next.pop();
      let run: Token[] = [];
      let links = 0;
      const flush = () => {
        if (run.some((t) => !isSpace(t))) {
          const inline = new state.Token('inline', '', 0);
          Object.assign(inline, { children: run, content: run.map((t) => t.content).join(''), map: token.map, level: token.level, block: true });
          next.push(open, inline, close);
        }
        run = [];
      };
      for (const child of token.children) {
        if (child.type === 'link_open') links++;
        if (child.type === 'link_close') links--;
        const imageOf = diagramIn(child) && !links ? imageJob(child.attrGet('src')!, child.content, child.attrGet('title'), dir, plain) : undefined;
        if (!imageOf) {
          if (diagramIn(child)) warn(`${shown}:${(token.map?.[0] ?? 0) + 1}: a diagram inside a link is left as it is: give it a line of its own`);
          run.push(child);
        } else {
          flush();
          next.push(...draw(imageOf, token, false));
        }
      }
      flush();
      i++;
    }
    state.tokens = next;
  });
}
