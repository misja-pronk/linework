// `carto export-html`: a diagram, or a folder of them, as one HTML file a customer opens from disk.
// A file brings along the diagrams of its folder that it links or drills into; a folder becomes a
// small site in one file, with a contents page. The work is in @cartography/html-export.
import fs from 'node:fs';
import path from 'node:path';
import { isDiagramFile, notesPath, parseNotes, type LayoutSidecar } from '@cartography/core';
import { exportHtml, type HtmlExportInput } from '@cartography/html-export';
import { decisionsRoot, workspaceAt } from './decisions.ts';

export interface HtmlFlags {
  title?: string;
  notes?: boolean;
  /** The architecture decisions of the folder: on the drawings, in the details and as a page. */
  decisions?: boolean;
  allSteps?: boolean;
  render: HtmlExportInput['render'];
}

/** Diagram files under a folder, relative to it with forward slashes; not hidden folders, node_modules or snapshots. */
function diagramsIn(dir: string, deep: boolean, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name.endsWith('.snapshots')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (deep) out.push(...diagramsIn(p, deep, base));
    } else if (/\.ya?ml$/i.test(e.name) && isDiagramFile(e.name, fs.readFileSync(p, 'utf8'))) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  // Shallow files first, as the editor lists a folder.
  return out.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

export async function exportHtmlFile(target: string, out: string | undefined, flags: HtmlFlags) {
  const folder = fs.statSync(target).isDirectory();
  const root = folder ? path.resolve(target) : path.dirname(path.resolve(target));
  const abs = (p: string) => path.resolve(root, p);
  const entries = folder ? diagramsIn(root, true) : [path.basename(target)];
  const input: HtmlExportInput = {
    entries,
    nearby: folder ? [] : diagramsIn(root, false),
    read: (p) => {
      try {
        return fs.readFileSync(abs(p), 'utf8');
      } catch {
        return undefined;
      }
    },
    title: flags.title,
    site: folder ? true : undefined,
    notes: flags.notes,
    ...(flags.decisions ? { decisions: workspaceAt(decisionsRoot(target)).decisions } : {}),
    allSteps: flags.allSteps,
    notesFor: (p) => {
      const f = notesPath(abs(p));
      return fs.existsSync(f) ? parseNotes(fs.readFileSync(f, 'utf8')).notes : undefined;
    },
    sidecarFor: (p) => {
      const f = abs(p).replace(/\.ya?ml$/i, '') + '.layout.json';
      try {
        return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as LayoutSidecar) : undefined;
      } catch {
        return undefined;
      }
    },
    assetsFor: (p) => (rel) => {
      const f = path.resolve(path.dirname(abs(p)), rel);
      return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : undefined;
    },
    render: flags.render,
  };
  const r = await exportHtml(input);
  const file = out ?? (folder ? `${path.resolve(target).replace(/[\\/]+$/, '')}.html` : target.replace(/\.ya?ml$/i, '') + '.html');
  if (r.stats.drawings) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, r.html);
  }
  return { ...r, file, root };
}
