// Imports from other diagram languages. Pure functions (text in, YAML out), shared by the CLI and the web app.
//
//   importMermaid(text)    flowchart/graph and architecture-beta → systems, erDiagram → erd, sequenceDiagram → sequence,
//                          gitGraph → gitflow, gantt and timeline → roadmap
//   importGitLog(text)     `git log --format=GIT_LOG_FORMAT` of a real repository → gitflow
//   importMarkdown(text)   every ```mermaid block in a Markdown file
//   importKubernetes(text) manifests (kubectl, helm template, kustomize build) → kubernetes
//   importNetwork(text)    CSV/YAML inventory (name,type,ip,zone,uplink) or NetBox JSON → network
//   importTerraform(text)  `terraform show -json` of a state or a plan (AWS, Google Cloud) → cloud
import { importArchitecture } from './architecture.ts';
import { importEr } from './er.ts';
import { importFlowchart } from './flowchart.ts';
import { importSequence } from './sequence.ts';
import { importGitGraph } from './gitgraph.ts';
import { importGantt, importTimeline } from './gantt.ts';
import { Warnings } from './text.ts';

export interface Imported {
  /** Cartography YAML; empty when nothing could be imported. */
  yaml: string;
  warnings: string[];
}

export { guessKind } from './systems.ts';
export { importKubernetes, isKubernetes } from './kubernetes.ts';
export { importNetwork, isNetworkInventory, networkKind } from './network.ts';
export { importStructurizr, isStructurizr } from './structurizr.ts';
export { importTerraform, isTerraform } from './terraform.ts';
export { GIT_LOG_FORMAT, importGitLog, type GitLogOptions } from './git.ts';

export function importMermaid(text: string, fallbackTitle?: string): Imported {
  const warn = new Warnings();
  let src = text.replace(/\r\n?/g, '\n');
  let title = fallbackTitle;
  // Front matter: only the title means something here.
  const front = /^\s*---\n([\s\S]*?)\n---\s*\n/.exec(src);
  if (front) {
    title = /^title:\s*(.+)$/m.exec(front[1]!)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? title;
    src = src.slice(front[0].length);
  }
  // A `%% title: …` comment names the diagram too, when the front matter does not.
  if (!front) title = /^\s*%%\s*title\s*:?\s+(.+?)\s*$/im.exec(src)?.[1] ?? title;
  const lines = src
    .replace(/%%\{[\s\S]*?\}%%/g, '')
    .split('\n')
    .filter((l) => !/^\s*%%/.test(l))
    .map((l) => l.replace(/\s+%%.*$/, ''));
  const start = lines.findIndex((l) => l.trim());
  if (start < 0) return { yaml: '', warnings: ['The Mermaid text is empty'] };
  const header = lines[start]!.trim();
  const body = lines.slice(start + 1);
  const t = /^\s*title\s+(.+)$/m.exec(body.join('\n'));
  if (t) {
    title = t[1]!.trim();
    body.splice(body.findIndex((l) => l.trim().startsWith('title ')), 1);
  }

  title ??= 'Imported diagram';
  const kind = header.split(/\s+/)[0]!;
  let yaml = '';
  if (/^(flowchart|graph)$/i.test(kind)) yaml = importFlowchart(body, header, title, warn);
  else if (/^architecture(-beta)?$/.test(kind)) yaml = importArchitecture(body, title, warn);
  else if (kind === 'erDiagram') yaml = importEr(body, title, warn);
  else if (kind === 'sequenceDiagram') yaml = importSequence(body, title, warn);
  else if (/^gitGraph/.test(kind)) yaml = importGitGraph(body, header, title, warn);
  else if (kind === 'gantt') yaml = importGantt(body, title, warn);
  else if (kind === 'timeline') yaml = importTimeline(body, title, warn);
  else warn.add(`Mermaid "${kind}" diagrams cannot be imported yet: flowchart, graph, architecture-beta, erDiagram, sequenceDiagram, gitGraph, gantt and timeline can`);
  return { yaml, warnings: warn.list };
}

export interface ImportedBlock extends Imported {
  /** 1-based line of the ```mermaid fence. */
  line: number;
}

/** Every ```mermaid (or ~~~mermaid) block; the nearest heading above one becomes its title when it has none. */
export function importMarkdown(text: string): ImportedBlock[] {
  const out: ImportedBlock[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let heading: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[i]!);
    if (h) heading = h[1]!.replace(/[*_`]/g, '');
    const fence = /^\s*(`{3,}|~{3,})\s*mermaid\b/.exec(lines[i]!);
    if (!fence) continue;
    const end = lines.findIndex((l, j) => j > i && l.trim().startsWith(fence[1]!));
    const block = lines.slice(i + 1, end < 0 ? lines.length : end).join('\n');
    out.push({ ...importMermaid(block, heading), line: i + 1 });
    i = end < 0 ? lines.length : end;
  }
  return out;
}
