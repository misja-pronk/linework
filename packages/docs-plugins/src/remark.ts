// The remark plugin: fenced ```cartography blocks and images that point at a .yaml file become
// drawings in the page. Works with remark-rehype and with MDX (Docusaurus, Astro, Next): the drawing
// is handed over as elements, not as raw HTML.
import path from 'node:path';
import { build, diagramReference, fenceJob, imageJob, pageStyle, problemText, type Built, type CartographyOptions, type Job } from './core.ts';
import { toHast, type El } from './tree.ts';

// The few parts of mdast and vfile used here, so the plugin needs no types from either.
interface Point {
  line: number;
  column: number;
}
interface Position {
  start: Point;
  end: Point;
}
interface Node {
  type: string;
  children?: Node[];
  position?: Position;
  data?: Record<string, unknown>;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  url?: string;
  alt?: string | null;
  title?: string | null;
}
interface VFile {
  path?: string;
  dirname?: string;
  cwd?: string;
  message(reason: string, place?: unknown, origin?: string): unknown;
  fail(reason: string, place?: unknown, origin?: string): never;
}

// A paragraph that says what it becomes: every mdast-to-hast route (remark-rehype, MDX) honours hName.
const block = (e: El, position?: Position): Node => {
  const h = toHast(e);
  return { type: 'paragraph', children: [], ...(position ? { position } : {}), data: { hName: h.tagName, hProperties: h.properties, hChildren: h.children } };
};

const isDiagram = (n: Node) => n.type === 'image' && typeof n.url === 'string' && !!diagramReference(n.url);
const isSpace = (n: Node) => n.type === 'break' || (n.type === 'text' && !n.value?.trim());

export default function remarkCartography(options: CartographyOptions = {}) {
  const strict = options.strict !== false;
  return async (tree: Node, file: VFile): Promise<void> => {
    const cwd = file.cwd ?? process.cwd();
    const dir = file.dirname ? path.resolve(cwd, file.dirname) : cwd;
    let styled = options.pageStyle === false;
    let fatal: { reason: string; place: unknown } | undefined;

    const report = (built: Built, node: Node, fenced: boolean) => {
      for (const p of built.problems) {
        // A problem in a fenced block is on a line of the markdown file; one in a diagram file is named with it.
        const place = fenced && p.line != null && node.position ? { line: node.position.start.line + p.line, column: p.column ?? 1 } : node.position;
        const reason = fenced ? p.message : problemText(p);
        if (p.severity === 'error' && strict && !fatal) fatal = { reason, place };
        else file.message(reason, place, 'cartography');
      }
    };
    const draw = async (job: Job, node: Node, fenced: boolean): Promise<Node[]> => {
      const built = await build(job);
      report(built, node, fenced);
      const out = [block(built.figure, node.position)];
      if (built.ok && !styled) {
        out.unshift(block(pageStyle(options)));
        styled = true;
      }
      return out;
    };

    const visit = async (parent: Node): Promise<void> => {
      const children = parent.children;
      if (!children) return;
      const next: Node[] = [];
      for (const child of children) {
        const job = child.type === 'code' ? fenceJob(`${child.lang ?? ''} ${child.meta ?? ''}`, child.value ?? '', dir, options) : undefined;
        if (job) next.push(...(await draw(job, child, true)));
        else if (child.type === 'paragraph' && child.children?.some(isDiagram)) {
          // A drawing is a block: the text around it in the same paragraph stays, as paragraphs before and after.
          let run: Node[] = [];
          const flush = () => {
            if (run.some((n) => !isSpace(n))) next.push({ ...child, children: run });
            run = [];
          };
          for (const n of child.children!) {
            const imageOf = isDiagram(n) ? imageJob(n.url!, n.alt, n.title, dir, options) : undefined;
            if (!imageOf) run.push(n);
            else {
              flush();
              next.push(...(await draw(imageOf, n, false)));
            }
          }
          flush();
        } else {
          if (isDiagram(child))
            file.message(`${child.url} is inside a link, heading or table and is left as it is: give the diagram a line of its own`, child.position, 'cartography');
          await visit(child);
          next.push(child);
        }
      }
      parent.children = next;
    };
    await visit(tree);
    if (fatal) file.fail(fatal.reason, fatal.place, 'cartography');
  };
}
