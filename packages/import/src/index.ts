// Imports from other diagram languages. Pure functions (text in, YAML out), shared by the CLI and the web app.
//
//   importMermaid(text)    flowchart/graph and architecture-beta → systems (a flowchart that decides → process),
//                          erDiagram → erd, sequenceDiagram → sequence, stateDiagram → states, gitGraph → gitflow,
//                          gantt and timeline → roadmap, journey → journey, classDiagram → class, mindmap → mindmap
//   importGitLog(text)     `git log --format=GIT_LOG_FORMAT` of a real repository → gitflow
//   importMarkdown(text)   every ```mermaid, ```d2 and ```plantuml block in a Markdown file
//   importD2(text)         D2 → systems (cloud when the icons say AWS or Google Cloud), its sql_tables → erd,
//                          each sequence_diagram → sequence; steps, scenarios and layers
//   importPlantUml(text)   PlantUML sequence → sequence, component and deployment → systems, C4-PlantUML → c4,
//                          state → states, activity → process, entity → erd, class → class, @startmindmap → mindmap
//   importText(text, name) any of these, by the file's ending or what the text looks like
//   importKubernetes(text) manifests (kubectl, helm template, kustomize build) → kubernetes
//   importNetwork(text)    CSV/YAML inventory (name,type,ip,zone,uplink) or NetBox JSON → network
//   importDataMesh(files)  data product files (ODPS) and data contracts (ODCS) → data-products
//   importTerraform(text)  `terraform show -json` of a state or a plan (AWS, Google Cloud) → cloud
//   importAccess(files)    az role assignments, Graph JSON (groups, directory roles, access packages), AzureHound → access
//   importGithub(files)    gh api responses (teams, repositories, rulesets, environments, …) → github, or access
//   importAzure(files)     Azure Resource Graph JSON, ARM templates (az bicep build), terraform show -json (azurerm) → azure
import { importArchitecture } from './architecture.ts';
import { importEr } from './er.ts';
import { importFlowchart } from './flowchart.ts';
import { importSequence } from './sequence.ts';
import { importGitGraph } from './gitgraph.ts';
import { importGantt, importTimeline } from './gantt.ts';
import { importJourney } from './journey.ts';
import { importState } from './state.ts';
import { Warnings } from './text.ts';
import { importD2 } from './d2.ts';
import { importPlantUml } from './plantuml.ts';
import { importMermaidClass, importMermaidMindmap } from './uml.ts';

export interface Imported {
  /** Cartography YAML; empty when nothing could be imported. */
  yaml: string;
  warnings: string[];
}

export { guessKind } from './systems.ts';
export { importKubernetes, isKubernetes } from './kubernetes.ts';
export { importNetwork, isNetworkInventory, networkKind } from './network.ts';
export { importStructurizr, isStructurizr } from './structurizr.ts';
export { dataFileKind, importDataMesh, isDataMeshFile, type DataFileKind, type ImportedMesh, type MeshFile, type MeshOptions, type MeshProblem } from './data-mesh.ts';
export { importTerraform, isTerraform } from './terraform.ts';
export { importGithub, isGithubExport, type GithubOptions } from './github-org.ts';
export { importAzure, isAzureContainers, isAzureExport, type AzureOptions } from './azure.ts';
export { importAccess, isAccessExport, type AccessOptions, type ExportFile, type ImportedExport } from './access.ts';
export { GIT_LOG_FORMAT, importGitLog, type GitLogOptions } from './git.ts';
export { importD2, type ImportedD2 } from './d2.ts';
export { importPlantUml, type ImportedUml } from './plantuml.ts';

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
  else if (/^stateDiagram(-v2)?$/.test(kind)) yaml = importState(body, title, warn);
  else if (/^gitGraph/.test(kind)) yaml = importGitGraph(body, header, title, warn);
  else if (kind === 'gantt') yaml = importGantt(body, title, warn);
  else if (kind === 'timeline') yaml = importTimeline(body, title, warn);
  else if (kind === 'journey') yaml = importJourney(body, title, warn);
  else if (/^classDiagram(-v2)?$/.test(kind)) yaml = importMermaidClass(body, title, warn);
  else if (kind === 'mindmap') yaml = importMermaidMindmap(body, t || front || fallbackTitle ? title : undefined, warn);
  else warn.add(`Mermaid "${kind}" diagrams cannot be imported yet: flowchart, graph, architecture-beta, erDiagram, sequenceDiagram, stateDiagram, classDiagram, gitGraph, gantt, timeline, journey and mindmap can`);
  return { yaml, warnings: warn.list };
}

export interface ImportedBlock extends Imported {
  /** 1-based line of the fence in Markdown; 0 for a file of its own. */
  line: number;
  /** What the diagram is, when one block or file gave several (a D2 layer, a PlantUML diagram's title). */
  name?: string;
}

export type Language = 'mermaid' | 'd2' | 'plantuml' | 'markdown';

const MERMAID = /^(flowchart|graph|architecture(-beta)?|erDiagram|sequenceDiagram|stateDiagram(-v2)?|gitGraph|gantt|timeline|journey|classDiagram(-v2)?|pie|mindmap|quadrantChart|requirementDiagram|C4\w+|xychart(-beta)?|sankey(-beta)?|block(-beta)?|packet(-beta)?|kanban|radar(-beta)?|treemap(-beta)?|zenuml)\b/;
const FENCE = /^\s*(`{3,}|~{3,})\s*(mermaid|d2|plantuml|puml|uml)\b/;

/** Which language a text is in: by the file's ending first, then by what it starts with. */
export function languageOf(text: string, name = ''): Language {
  if (/\.(mmd|mermaid)$/i.test(name)) return 'mermaid';
  if (/\.d2$/i.test(name)) return 'd2';
  if (/\.(puml|plantuml|pu|iuml|wsd)$/i.test(name)) return 'plantuml';
  if (/\.(md|markdown)$/i.test(name)) return 'markdown';
  if (/^\s*@start\w+/m.test(text)) return 'plantuml';
  if (text.split('\n').some((l) => FENCE.test(l))) return 'markdown';
  const src = text.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '');
  const first = src.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%')) ?? '';
  if (MERMAID.test(first)) return 'mermaid';
  // PlantUML without @startuml: C4 macros, or participants and arrows with a colon.
  if (/^\s*(!include|skinparam\b|(Person|System|Container|Component|Rel)(_\w+)?\s*\()/m.test(text) || /^\s*participant\s+\S+(\s+as\s+\S+)?\s*$/m.test(text)) return 'plantuml';
  // D2: a shape:, a direction:, a block or a connection, outside any of the above.
  if (/^\s*(direction|shape)\s*:|^[^%\n]*\{\s*$|^\s*[\w"'][^:\n]*?\s*(<->|<-|->|--)\s*[\w"']/m.test(text)) return 'd2';
  return 'mermaid';
}

/** A file or a paste, in whichever language it is: one block per diagram. */
export function importText(text: string, name = ''): ImportedBlock[] {
  const base = name.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '') || undefined;
  const lang = languageOf(text, name);
  if (lang === 'markdown') return importMarkdown(text);
  if (lang === 'd2') return importD2(text, base).map((b) => ({ ...b, line: 0 }));
  if (lang === 'plantuml') return importPlantUml(text, base).map((b) => ({ ...b, line: 0 }));
  return [{ ...importMermaid(text), line: 0 }];
}

/** Every ```mermaid, ```d2 and ```plantuml (or ~~~) block; the nearest heading above one becomes its title when it has none. */
export function importMarkdown(text: string): ImportedBlock[] {
  const out: ImportedBlock[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let heading: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[i]!);
    if (h) heading = h[1]!.replace(/[*_`]/g, '');
    const fence = FENCE.exec(lines[i]!);
    if (!fence) continue;
    const end = lines.findIndex((l, j) => j > i && l.trim().startsWith(fence[1]!));
    const block = lines.slice(i + 1, end < 0 ? lines.length : end).join('\n');
    const lang = fence[2]!;
    if (lang === 'mermaid') out.push({ ...importMermaid(block, heading), line: i + 1 });
    else for (const b of lang === 'd2' ? importD2(block, heading) : importPlantUml(block, heading)) out.push({ ...b, line: i + 1 });
    i = end < 0 ? lines.length : end;
  }
  return out;
}
