// PlantUML → sequence, systems, c4, states, process or erd, by what the diagram is:
//
//   sequence             participants (actor, database, queue, …), ->, -->, ->>, ->x, activations (++/--,
//                        activate, return), alt/else/opt/loop/par/break/critical/group, notes, refs,
//                        autonumber, == dividers ==, boxes                                       → sequence
//   component, deployment component, [x], node, database, cloud, queue, interface, …; package, frame,
//                        node, cloud, rectangle { … } as groups; -->, ..>, --, <-- with labels    → systems
//   C4-PlantUML          Person, System(_Ext/Db/Queue), Container(Db/Queue), Component, Rel(_*),
//                        System_Boundary, Container_Boundary, Enterprise_Boundary, Deployment_Node
//                                                                     → c4: the model and the view drawn
//   state                [*], state X { … }, <<choice>>, notes                                       → states
//   activity (new)       start/stop, :action;, if/elseif/else, while, repeat, fork, split, switch,
//                        |swimlanes|                                                               → process
//   entity               entity X { … } with crow's feet                                           → erd
//
// Class, use case, mindmap and wbs diagrams are named in a warning, not imported. skinparam, !theme,
// colours and stereotypes are left out: the theme draws each kind its own way.
import { importEr } from './er.ts';
import { importState } from './state.ts';
import { processYaml, type FlowLink, type FlowNode } from './process.ts';
import { participantKind, sequenceYaml, type Participant, type Step } from './sequence.ts';
import { c4Yaml } from './structurizr.ts';
import { guessGroupKind, guessKind, systemsYaml, type SysEdge, type SysGroup, type SysNode } from './systems.ts';
import { Ids, scalar, slug, Warnings } from './text.ts';

export interface ImportedUml {
  yaml: string;
  warnings: string[];
  /** The diagram's title (or "Diagram n"), when the file holds more than one. */
  name?: string;
}

const STARTS = /^\s*@start(\w+)\b(.*)$/;

/** Every @startuml … @enduml block (the whole text when there is none). */
export function importPlantUml(text: string, fallbackTitle = 'Imported diagram'): ImportedUml[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: { tag: string; body: string[]; name?: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = STARTS.exec(lines[i]!);
    if (!m) continue;
    const end = lines.findIndex((l, j) => j > i && /^\s*@end\w*/.test(l));
    blocks.push({ tag: m[1]!.toLowerCase(), body: lines.slice(i + 1, end < 0 ? lines.length : end), name: m[2]!.trim().replace(/^\(id=|\)$/g, '').replace(/^["']|["']$/g, '') || undefined });
    i = end < 0 ? lines.length : end;
  }
  if (!blocks.length) blocks.push({ tag: 'uml', body: lines });
  return blocks.map((b, i) => {
    const r = importUml(b.tag, b.body, blocks.length > 1 ? `${fallbackTitle} ${i + 1}` : fallbackTitle);
    return blocks.length > 1 ? { ...r, name: r.title ?? b.name ?? `Diagram ${i + 1}` } : { yaml: r.yaml, warnings: r.warnings };
  });
}

const PLANNED: Record<string, string> = {
  mindmap: 'Mindmaps cannot be imported yet: a mind map type is planned',
  wbs: 'Work breakdown structures (wbs) cannot be imported yet: a tree type is planned',
  gantt: 'PlantUML Gantt charts cannot be imported: write them as a roadmap (type: roadmap), or import a Mermaid gantt',
};

function importUml(tag: string, raw: string[], fallbackTitle: string): { yaml: string; warnings: string[]; title?: string } {
  const warn = new Warnings();
  if (tag !== 'uml') return { yaml: '', warnings: [PLANNED[tag] ?? `@start${tag} is not a diagram Cartography can import`] };
  const pre = preprocess(raw, warn);
  const title = pre.title ?? fallbackTitle;
  const body = pre.lines;
  const kind = kindOf(body, pre.includes);
  let yaml = '';
  if (kind === 'c4') yaml = c4(body, pre.includes, title, warn);
  else if (kind === 'activity') yaml = activity(body, title, warn);
  else if (kind === 'state') yaml = state(body, title, warn);
  else if (kind === 'er') yaml = er(body, title, warn);
  else if (kind === 'component') yaml = component(body, title, pre.direction, warn);
  else if (kind === 'sequence') yaml = sequence(body, title, warn);
  else if (kind === 'class') warn.add('Class diagrams cannot be imported yet: a class diagram type is planned');
  else if (kind === 'usecase') warn.add('Use case diagrams cannot be imported: Cartography has no use case type');
  else if (kind === 'old-activity') warn.add('Activity diagrams in the old syntax ((*) --> "step") cannot be imported: the new syntax (start, :step;, stop) can');
  else warn.add(body.some((l) => l.trim()) ? 'This PlantUML diagram is not one Cartography can read: sequence, component, deployment, C4, state, activity and entity diagrams can' : 'The PlantUML text is empty');
  return { yaml, warnings: warn.list, ...(pre.title ? { title: pre.title } : {}) };
}

// ---------------------------------------------------------------- reading

interface Pre {
  lines: string[];
  title?: string;
  includes: string[];
  direction?: 'right' | 'down';
}

/** Comments, skinparams, themes, includes, title, legends and the like out; what is left is the diagram. */
function preprocess(raw: string[], warn: Warnings): Pre {
  const out: string[] = [];
  const includes: string[] = [];
  let title: string | undefined;
  let direction: Pre['direction'];
  const text = raw.join('\n').replace(/\/'[\s\S]*?'\//g, '');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i]!.trim();
    if (!s || s.startsWith("'")) continue;
    let m: RegExpExecArray | null;
    // A block of its own: skinparam x { … }, legend … endlegend, title … end title.
    const until = (end: RegExp) => {
      const j = lines.findIndex((l, k) => k > i && end.test(l.trim()));
      const inner = lines.slice(i + 1, j < 0 ? lines.length : j);
      i = j < 0 ? lines.length : j;
      return inner;
    };
    if (/^skinparam\b/i.test(s)) {
      warn.onceFor('skin', 'skinparam and themes are left out: the theme draws each kind its own way');
      if (s.endsWith('{')) until(/^\}$/);
    } else if (/^!(theme|define|pragma|function|procedure|unquoted|endfunction|endprocedure|global|local|log|dump|assert|import)\b/i.test(s) || /^!\$/.test(s)) {
      if (/^!theme/i.test(s)) warn.onceFor('skin', 'skinparam and themes are left out: the theme draws each kind its own way');
      else warn.onceFor('pre', 'Preprocessor lines (!define, !function, …) are left out');
    } else if (/^!(if|ifdef|ifndef|else|elseif|endif|while|endwhile|foreach|endfor)\b/i.test(s)) warn.onceFor('pre', 'Preprocessor lines (!define, !function, …) are left out');
    else if ((m = /^!include(?:url|sub)?\s+(.+)$/i.exec(s))) includes.push(m[1]!.trim());
    else if ((m = /^title\s*(.*)$/i.exec(s)) && !/^title\s*:/.test(s)) title = m[1]!.trim() ? clean(m[1]!) : until(/^end\s*title$/i).map(clean).join(' ');
    else if (/^(legend|header|footer|caption)\b/i.test(s)) {
      if (/^legend\b/i.test(s)) until(/^end\s*legend$/i);
      else if (/^(header|footer)\s*$/i.test(s)) until(/^end\s*(header|footer)$/i);
      warn.onceFor('legend', 'Legends, headers, footers and captions are left out: the key is drawn for you');
    } else if (/^left to right direction$/i.test(s)) direction = 'right';
    else if (/^top to bottom direction$/i.test(s)) direction = 'down';
    else if (/^(hide|show|scale|newpage|allowmixing|allow_mixing|set\s+separator|remove|restore|!option)\b/i.test(s)) {
      if (/^newpage/i.test(s)) warn.onceFor('newpage', 'newpage: all pages come in as one diagram');
    } else out.push(s);
  }
  return { lines: out, ...(title ? { title } : {}), includes, ...(direction ? { direction } : {}) };
}

/** A PlantUML label: quotes, \n, creole markup and <tags> out. */
function clean(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s
    .replace(/\\n/g, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\*\*|\/\/|""|__|~~|--(?=\S)/g, '')
    .replace(/<\$[\w-]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const C4_MACRO = /^(Person|System|Container|Component|Rel|BiRel|RelIndex|System_Boundary|Container_Boundary|Enterprise_Boundary|Boundary|Deployment_Node|Node)(_\w+)?\s*\(/;

type Kind = 'c4' | 'activity' | 'old-activity' | 'state' | 'class' | 'er' | 'usecase' | 'component' | 'sequence' | 'none';

function kindOf(lines: string[], includes: string[]): Kind {
  const any = (r: RegExp) => lines.some((l) => r.test(l));
  if (includes.some((i) => /c4[_-]/i.test(i)) || any(C4_MACRO)) return 'c4';
  if (any(/^\(\*\)/)) return 'old-activity';
  if (any(/^(start|stop|end)$/) || any(/^:[\s\S]*[;|<>/\]}]$/) || any(/^:[^:]*$/) || any(/^if\s*\(.*\)\s*then\b/) || any(/^\|[^|]+\|(\s*[^|]+\|)?$/) || any(/^(fork|repeat|endwhile|endif|end fork|end split)\b/)) return 'activity';
  if (any(/\[\*\]/) || any(/^state\s/)) return 'state';
  if (any(/^(abstract\s+)?(class|enum|annotation|abstract)\s/) || any(/<\|--|--\|>|\*--|--\*|o--|--o\b/)) return 'class';
  if (any(/^entity\s+.*\{\s*$/)) return 'er';
  if (any(/^(usecase|\(.+\)\s*as\b)/) || any(/(^|\s)\([^)]+\)\s*$/)) return 'usecase';
  const sequence = any(/^(participant|activate|deactivate|autonumber|alt|loop|opt|par|break|critical|group|return|ref over|destroy|create)\b/) || any(/^==.*==$/) || any(/^\.\.\..*$/) || any(/^note (over|across)\b/);
  if (!sequence && (any(/^(component|node|cloud|package|frame|folder|rectangle|artifact|storage|card|file|interface|agent|stack|hexagon|port|portin|portout)\b/) || any(/^\[[^\]]+\]/) || any(/^\(\)/) || any(/\{$/))) return 'component';
  if (any(/^(component|node|cloud|package|frame|folder|rectangle|artifact|storage|card|file|interface)\b/) && !any(/^(participant|activate|alt|loop|autonumber|return)\b/)) return 'component';
  if (any(/-+>|<-+|->>/)) return 'sequence';
  return 'none';
}

/** `"Long name" as id`, `id as "Long name"`, `[Long name] as id`, `id`: the id and the name. */
function named(raw: string): { id: string; label: string } {
  const s = raw.replace(/\s*<<[^>]*>>/g, '').replace(/\s+#[\w#]+.*$/, '').replace(/\s*\[\[[^\]]*\]\]/g, '').replace(/\s+order\s+\d+$/, '').trim();
  let m: RegExpExecArray | null;
  if ((m = /^(?:"([^"]+)"|\[([^\]]+)\]|(\S+))\s+as\s+(?:"([^"]+)"|(\S+))$/.exec(s))) {
    const left = m[1] ?? m[2] ?? m[3]!;
    const right = m[4] ?? m[5]!;
    // The quoted (or bracketed) side is the name, the other the id.
    return m[4] !== undefined && m[1] === undefined && m[2] === undefined ? { id: left, label: clean(right) } : { id: right, label: clean(left) };
  }
  if ((m = /^"([^"]+)"$|^\[([^\]]+)\]$/.exec(s))) return { id: m[1] ?? m[2]!, label: clean(m[1] ?? m[2]!) };
  return { id: s, label: clean(s) };
}

// ---------------------------------------------------------------- sequence

const P_TYPES: Record<string, string> = { actor: 'person', database: 'database', queue: 'queue', collections: 'service', entity: 'database', boundary: 'system', control: 'service' };
const SEQ_NAME = String.raw`("[^"]+"|\[|\]|\?|[\p{L}\p{N}_.@$]+)`;
const SEQ_ARROW = String.raw`((?:(?<=\s)[ox])?(?:<<|<|\\\\|\\|//|/)?-{1,2}(?:\[[^\]]*\])?-?(?:>>|>|\\\\|\\|//|/)?(?:[ox](?=\s|$|:))?)`;
const SEQ_MSG = new RegExp(String.raw`^${SEQ_NAME}\s*${SEQ_ARROW}\s*${SEQ_NAME}\s*(\+\+|--|\*\*|!!)?\s*(?:#\w+\s*)?(?::(.*))?$`, 'u');

function sequence(lines: string[], title: string, warn: Warnings): string {
  const ids = new Ids();
  const participants = new Map<string, Participant>();
  const boxes: { id: string; label: string }[] = [];
  let box: string | undefined;
  let autonumber = false;
  let explicit = false;
  let auto = false;
  const root: Step[] = [];
  const stack: Extract<Step, { frame: string }>[] = [];
  const calls: { from: string; to: string }[] = [];
  let last: { from: string; to: string } | undefined;
  const current = () => {
    const f = stack.at(-1);
    return f ? (f.branches.at(-1)?.steps ?? f.steps) : root;
  };
  const declare = (raw: string, label?: string, kind?: string): string => {
    const source = raw.replace(/^"|"$/g, '');
    let p = participants.get(source);
    if (!p) {
      const text = label ?? clean(source);
      const id = ids.get(source, slug(source));
      participants.set(source, (p = { id, kind: kind ?? participantKind(text), ...(text !== id ? { label: text } : {}), ...(box ? { box } : {}) }));
    }
    return p.id;
  };
  const outside = (end: string) => {
    if (end !== '[' && end !== ']' && end !== '?') return undefined;
    warn.onceFor('outside', 'Messages from or to outside the diagram ([-> and ->]) come from a participant called Outside');
    return declare('Outside', 'Outside', 'external');
  };

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i]!;
    let m: RegExpExecArray | null;
    // A note or a ref over several lines, up to its end line.
    const multi = (end: RegExp) => {
      const j = lines.findIndex((l, k) => k > i && end.test(l));
      const text = lines.slice(i + 1, j < 0 ? lines.length : j).map(clean).join(' ');
      i = j < 0 ? lines.length : j;
      return text;
    };
    if ((m = /^(create\s+)?(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+)$/i.exec(s))) {
      if (m[1]) warn.onceFor('create', 'create is drawn as a participant from the start');
      const n = named(m[3]!);
      const kind = m[2]!.toLowerCase();
      declare(n.id, n.label, P_TYPES[kind] ?? participantKind(n.label));
    } else if ((m = /^create\s+(.+)$/i.exec(s))) {
      warn.onceFor('create', 'create is drawn as a participant from the start');
      declare(named(m[1]!).id);
    } else if ((m = /^box\b\s*(.*)$/i.exec(s))) {
      const label = clean(m[1]!.replace(/#[\w#]+/g, '')) || 'Box';
      box = ids.get(`box:${label}`, slug(label).toLowerCase() || 'box');
      boxes.push({ id: box, label });
    } else if (/^end\s*box$/i.test(s)) box = undefined;
    else if (/^autonumber\b/i.test(s)) {
      if (!/stop/i.test(s)) autonumber = true;
    } else if (/^autoactivate\s+on/i.test(s)) auto = true;
    else if ((m = /^(activate|deactivate)\s+(\S+)/i.exec(s))) {
      explicit = true;
      const id = declare(named(m[2]!).id);
      current().push({ line: `${m[1]!.toLowerCase()}: ${id}` });
      if (m[1]!.toLowerCase() === 'activate' && last && last.to === id) calls.push(last);
      if (m[1]!.toLowerCase() === 'deactivate') calls.splice(calls.map((c) => c.to).lastIndexOf(id), 1);
    } else if ((m = /^destroy\s+(\S+)/i.exec(s))) {
      declare(named(m[1]!).id);
      warn.onceFor('destroy', 'destroy is not drawn: the lifeline runs to the end');
    } else if ((m = /^return\b\s*(.*)$/i.exec(s))) {
      const call = calls.pop();
      if (!call) {
        warn.onceFor('return', 'A return without an activation to return from was left out');
        continue;
      }
      explicit = true;
      const label = clean(m[1]!);
      current().push({ line: `${call.to} --> -${call.from}${label ? `: ${scalar(label)}` : ''}` });
    } else if ((m = /^[hr]?note\s+(left|right|over|across)(?:\s+of)?\s*([^:]*?)\s*(?:#\w+\s*)?(?::(.*))?$/i.exec(s))) {
      const side = m[1]!.toLowerCase();
      const text = m[3] !== undefined ? clean(m[3]) : multi(/^end\s*[hr]?note$/i);
      let where = m[2]!.trim() ? m[2]!.split(',').map((x) => declare(named(x.trim()).id)) : [];
      // A note without a participant goes with the last message.
      if (!where.length) where = side === 'across' ? [...participants.values()].map((p) => p.id) : last ? [side === 'right' ? last.to : last.from] : [];
      if (!where.length) continue;
      const key = side === 'left' || side === 'right' ? side : 'over';
      const at = key === 'over' && where.length > 1 ? `[${where.join(', ')}]` : where[0]!;
      current().push({ line: `note: ${scalar(text || ' ')}\n  ${key}: ${at}` });
    } else if ((m = /^ref\s+over\s+([^:]+?)\s*(?::(.*))?$/i.exec(s))) {
      const where = m[1]!.split(',').map((x) => declare(named(x.trim()).id));
      const text = m[2] !== undefined ? clean(m[2]) : multi(/^end\s*ref$/i);
      current().push({ line: `ref: ${scalar(text || 'ref')}\n  over: ${where.length > 1 ? `[${where.join(', ')}]` : where[0]}` });
    } else if ((m = /^(alt|opt|loop|par|break|critical|group)\b\s*(.*)$/i.exec(s))) {
      const kind = m[1]!.toLowerCase();
      // group Label [second label]: the second part has no place here.
      const label = clean(m[2]!.replace(/\s*\[[^\]]*\]\s*$/, '').replace(/#\w+/g, '')) || undefined;
      const f = { frame: kind, label, steps: [], branches: [] };
      current().push(f);
      stack.push(f);
    } else if ((m = /^else\b\s*(.*)$/i.exec(s))) stack.at(-1)?.branches.push({ label: clean(m[1]!.replace(/#\w+/g, '')) || undefined, steps: [] });
    else if (/^end$/i.test(s)) stack.pop();
    else if ((m = /^==\s*(.*?)\s*==$/.exec(s))) current().push({ line: `divider: ${scalar(clean(m[1]!) || ' ')}` });
    else if ((m = /^\.\.\.\s*(.*?)\s*(?:\.\.\.)?$/.exec(s))) {
      warn.onceFor('delay', 'Delays (...) are drawn as dividers');
      current().push({ line: `divider: ${scalar(clean(m[1]!) || '…')}` });
    } else if (/^\|\|\d*\|\|$|^\|\|\|$/.test(s) || /^(hide|show)\b/i.test(s)) continue;
    else if ((m = SEQ_MSG.exec(s))) {
      const [, a, op, z, act, text] = m;
      const left = op!.startsWith('<') || op!.startsWith('o<') || op!.startsWith('x<');
      const right = /(>|\\|\/)[ox]?$/.test(op!) || /[ox]$/.test(op!) && !left;
      const back = left && !right;
      if (left && right) warn.onceFor('both', 'Two-way arrows (<->) are drawn one way');
      const from = outside(back ? z! : a!) ?? declare(named(back ? z! : a!).id);
      const to = outside(back ? a! : z!) ?? declare(named(back ? a! : z!).id);
      const dotted = /--/.test(op!.replace(/\[[^\]]*\]/, ''));
      const open = />>|\\\\|\/\/|<<|^\\|\/$/.test(op!.replace(/\[[^\]]*\]/, ''));
      const lost = /x$/.test(op!) || (back && /^x/.test(op!));
      const arrow = lost ? '-x' : dotted ? '-->' : open ? '->>' : '->';
      let sign = '';
      if (act === '++') {
        explicit = true;
        sign = '+';
        calls.push({ from, to });
      } else if (act === '--') {
        explicit = true;
        sign = '-';
        calls.splice(calls.map((c) => c.to).lastIndexOf(from), 1);
      } else if (act) warn.onceFor('createdestroy', 'Create and destroy marks on a message (** and !!) are left out');
      // In our arrows the sign goes before the receiver and closes the sender's activation.
      const label = text !== undefined ? clean(text) : '';
      const key = sign === '-' ? `${from} ${arrow} -${to}` : `${from} ${arrow} ${sign}${to}`;
      current().push({ line: label ? `${key}: ${scalar(label)}` : key });
      last = { from, to };
    } else warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
  }
  if (auto && !explicit) explicit = false;
  return sequenceYaml({ title, autonumber, explicit: explicit && !auto, boxes, participants: [...participants.values()], steps: root });
}

// ---------------------------------------------------------------- component and deployment

const ELEMENT = /^(component|node|database|cloud|package|frame|folder|rectangle|artifact|storage|queue|card|file|interface|agent|stack|hexagon|collections|actor|person|usecase|boundary|control|entity|label|process|action|circle|together|port|portin|portout)\s+(.*?)\s*(\{)?$/i;
const GROUPING = new Set(['package', 'node', 'frame', 'folder', 'rectangle', 'cloud', 'database', 'component', 'card', 'storage', 'stack', 'hexagon', 'agent', 'artifact', 'file', 'queue', 'collections']);
const LEAF: Record<string, string> = {
  database: 'database', queue: 'queue', storage: 'storage', file: 'storage', folder: 'storage', actor: 'user', person: 'user', interface: 'api', port: 'api', portin: 'api', portout: 'api', cloud: 'external', node: 'server', artifact: 'container',
};
const C_END = String.raw`(\[[^\]]+\]|"[^"]+"|\(\)\s*"?[^"\s]+"?|:[^:]+:|[\p{L}\p{N}_.]+(?:::[\p{L}\p{N}_]+)?)`;
const C_ARROW = String.raw`([<*o#x}+^(|]*)([-.=~]+)(?:\[([^\]]*)\])?((?:left|right|up|down|le|ri|do|l|r|u|d)?)([-.=~]*)([>*o#x{+^)|]*)`;
const C_REL = new RegExp(String.raw`^${C_END}\s*(?:"[^"]*"\s*)?${C_ARROW}\s*(?:"[^"]*"\s*)?${C_END}\s*(?::(.*))?$`, 'u');

function component(lines: string[], title: string, direction: 'right' | 'down' | undefined, warn: Warnings): string {
  const ids = new Ids();
  const groups: SysGroup[] = [];
  const nodes: SysNode[] = [];
  const edges: SysEdge[] = [];
  const byName = new Map<string, string>();
  const notes = new Set<string>();
  const stack: (string | undefined)[] = [];
  const parent = () => stack.findLast((x) => x !== undefined);

  const add = (keyword: string, id: string, label: string, open: boolean) => {
    const our = ids.get(id, slug(id));
    byName.set(id, our);
    byName.set(label, our);
    if (open && GROUPING.has(keyword)) {
      const guess = guessGroupKind(label);
      groups.push({ id: our, label, kind: keyword === 'cloud' && guess === 'group' ? 'cloud' : guess, parent: parent() });
      stack.push(our);
      return our;
    }
    if (open) stack.push(undefined);
    const guess = guessKind(label);
    let kind = LEAF[keyword] && !['cloud', 'node', 'artifact', 'folder'].includes(keyword) ? LEAF[keyword]! : (guess ?? LEAF[keyword] ?? 'service');
    if (keyword === 'database' && guess && ['cache', 'warehouse', 'search', 'storage'].includes(guess)) kind = guess;
    if (keyword === 'queue' && guess === 'topic') kind = 'topic';
    if ((keyword === 'actor' || keyword === 'person') && guess === 'users') kind = 'users';
    if (keyword === 'usecase') warn.onceFor('usecase', 'Use cases come in as boxes: there is no use case type');
    nodes.push({ id: our, label, kind, parent: parent() });
    return our;
  };
  const ref = (raw: string): string | undefined => {
    let s = raw.trim();
    if (/^\(\)/.test(s)) s = s.replace(/^\(\)\s*/, '').replace(/^"|"$/g, '');
    else if (/^:.*:$/.test(s)) s = s.slice(1, -1);
    else if (/^\[.*\]$/.test(s)) s = s.slice(1, -1);
    else s = s.replace(/^"|"$/g, '').replace(/::.*$/, '');
    if (notes.has(s)) return undefined;
    const known = byName.get(s);
    if (known) return known;
    const kind = /^\[/.test(raw.trim()) ? 'component' : /^\(\)/.test(raw.trim()) ? 'interface' : /^:/.test(raw.trim()) ? 'actor' : 'component';
    return add(kind, s, clean(s), false);
  };

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i]!;
    let m: RegExpExecArray | null;
    if (s === '}') {
      stack.pop();
      continue;
    }
    if ((m = /^note\b(.*)$/i.exec(s))) {
      const alias = /\bas\s+(\w+)\s*$/.exec(m[1]!)?.[1];
      if (alias) notes.add(alias);
      if (!m[1]!.includes(':') && !/^\s*"/.test(m[1]!)) {
        const j = lines.findIndex((l, k) => k > i && /^end\s*note$/i.test(l));
        if (j >= 0) i = j;
      }
      warn.onceFor('note', 'Notes are left out');
      continue;
    }
    if ((m = ELEMENT.exec(s))) {
      const keyword = m[1]!.toLowerCase();
      if (keyword === 'together') {
        if (m[3]) stack.push(undefined);
        continue;
      }
      // A description in brackets: rectangle X [ … ] (over several lines too).
      let rest = m[2]!;
      if (/\[\s*$/.test(rest) || (/\[[^\]]*$/.test(rest) && !/^\[/.test(rest))) {
        const j = lines.findIndex((l, k) => k >= i + 1 && /\]\s*\{?$/.test(l));
        rest = rest.replace(/\s*\[[^\]]*$/, '');
        if (j >= 0) i = j;
      }
      rest = rest.replace(/\s*\[[^\]]*\]$/, (x) => (/^\s*\[/.test(rest) ? x : ''));
      const n = named(rest);
      add(keyword, n.id, n.label, !!m[3]);
      continue;
    }
    if ((m = /^\[([^\]]+)\](?:\s+as\s+(\S+))?\s*(?:<<[^>]*>>)?\s*(?:#\w+)?\s*(\{)?$/.exec(s))) {
      add('component', m[2] ?? m[1]!, clean(m[1]!), !!m[3]);
      continue;
    }
    if ((m = /^\(\)\s*(.+?)\s*(\{)?$/.exec(s))) {
      const n = named(m[1]!);
      add('interface', n.id, n.label, !!m[2]);
      continue;
    }
    if ((m = C_REL.exec(s))) {
      const [, a, head, line, hint, , line2, tail, z, text] = m;
      if (/hidden/i.test(hint ?? '')) continue;
      const [from, to] = [ref(a!), ref(z!)];
      if (!from || !to) continue;
      const points = { left: /<|\|>/.test(head!) || head === '<|', right: />/.test(tail!) };
      const dotted = /\./.test(line! + (line2 ?? ''));
      const label = text !== undefined ? clean(text) : undefined;
      const [f, t] = points.left && !points.right ? [to, from] : [from, to];
      edges.push({ from: f, to: t, op: points.left && points.right ? '<->' : points.left || points.right ? '->' : '--', ...(label ? { label } : {}), ...(dotted ? { style: 'async' as const } : {}) });
      continue;
    }
    if (/^(skinparam|hide|show|sprite)\b/i.test(s)) continue;
    warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
  }
  return systemsYaml({ title, direction: direction ?? 'right', groups, nodes, edges });
}

// ---------------------------------------------------------------- C4-PlantUML

/** Arguments of a macro call: quoted or bare, split at commas outside quotes and brackets; $name=value as named. */
function args(raw: string): { pos: string[]; named: Record<string, string> } {
  const pos: string[] = [];
  const named: Record<string, string> = {};
  let cur = '';
  let quote = false;
  let depth = 0;
  const flush = () => {
    const t = cur.trim();
    cur = '';
    const n = /^\$(\w+)\s*=\s*(.*)$/s.exec(t);
    if (n) named[n[1]!.toLowerCase()] = unq(n[2]!);
    else pos.push(unq(t));
  };
  for (const c of raw) {
    if (c === '"') quote = !quote;
    else if (!quote && (c === '(' || c === '[')) depth++;
    else if (!quote && (c === ')' || c === ']')) depth--;
    if (c === ',' && !quote && depth === 0) flush();
    else cur += c;
  }
  if (cur.trim() || pos.length) flush();
  return { pos, named };
}
const unq = (s: string) => s.trim().replace(/^"([\s\S]*)"$/, '$1');

interface C4El {
  alias: string;
  kind: string;
  label: string;
  technology?: string;
  description?: string;
  external?: boolean;
  inside?: boolean;
  parent?: C4El;
  children: C4El[];
}
interface DNode {
  key: string;
  label: string;
  technology?: string;
  instances: C4El[];
  nodes: DNode[];
}

function c4(lines: string[], includes: string[], title: string, warn: Warnings): string {
  const els = new Map<string, C4El>();
  const top: C4El[] = [];
  const rels: { from: string; to: string; label?: string; technology?: string; back?: boolean; both?: boolean; index?: number }[] = [];
  const dnodes: DNode[] = [];
  const dIds = new Ids();
  // What each open brace is: an element boundary, a deployment node or nothing of its own (enterprise, generic boundary).
  const stack: ({ el: C4El } | { node: DNode } | { enterprise: string } | { none: true })[] = [];
  let enterprise: string | undefined;
  let synthetic: C4El | undefined;

  const keyOf = (alias: string, siblings: C4El[]) => {
    let key = slug(alias).toLowerCase();
    for (let n = 2; siblings.some((s) => slug(s.alias).toLowerCase() === key && s.alias !== alias); n++) key = `${slug(alias).toLowerCase()}-${n}`;
    return key;
  };
  const parentEl = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const s = stack[i]!;
      if ('el' in s) return s.el;
    }
    return undefined;
  };
  const inNode = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const s = stack[i]!;
      if ('node' in s) return s.node;
      if ('el' in s) return undefined;
    }
    return undefined;
  };
  const inEnterprise = () => stack.some((s) => 'enterprise' in s);
  const home = (): C4El => {
    if (!synthetic) {
      synthetic = { alias: slug(title).toLowerCase(), kind: 'software-system', label: title, children: [] };
      top.push(synthetic);
      warn.add(`Containers outside a System_Boundary are put in a software system called "${title}"`);
    }
    return synthetic;
  };
  const place = (el: C4El, level: 'top' | 'container' | 'component') => {
    let p = parentEl();
    if (level === 'top') p = undefined;
    else if (level === 'container') {
      while (p && p.kind !== 'software-system') p = p.parent;
      p ??= home();
    } else {
      while (p && !isContainer(p)) p = p.parent;
      if (!p) {
        const sys = home();
        p = sys.children.find((c) => c.alias === `${sys.alias}-parts`);
        if (!p) {
          p = { alias: `${sys.alias}-parts`, kind: 'container', label: 'Components', parent: sys, children: [] };
          sys.children.push(p);
          warn.add('Components outside a Container_Boundary are put in a container called "Components"');
        }
      }
    }
    el.parent = p;
    (p ? p.children : top).push(el);
    els.set(el.alias, el);
    if (inEnterprise()) el.inside = true;
    const node = inNode();
    if (node && level !== 'top' || node && el.kind === 'software-system') node!.instances.push(el);
  };

  for (const s of lines) {
    if (s === '}') {
      stack.pop();
      continue;
    }
    const m = /^(\w+)\s*\((.*)\)\s*(\{)?\s*$/s.exec(s);
    if (!m) {
      if (s.endsWith('{')) stack.push({ none: true });
      else if (!/^(skinparam|hide|show)\b/i.test(s)) warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
      continue;
    }
    const [, macro, raw, open] = m;
    const a = args(raw!);
    const [p0, p1, p2, p3] = a.pos;
    const ext = /_Ext$/.test(macro!);
    const base = macro!.replace(/_Ext$/, '');
    const descr = a.named.descr ?? undefined;
    const techn = a.named.techn ?? a.named.type ?? undefined;
    const tagged = /external|ext\b/i.test(a.named.tags ?? '');
    let opened: (typeof stack)[number] | undefined;
    if (/^Person$/.test(base)) {
      const el: C4El = { alias: p0!, kind: 'person', label: p1 ?? p0!, ...((p2 ?? descr) ? { description: p2 ?? descr } : {}), ...(ext || tagged ? { external: true } : {}), children: [] };
      place(el, 'top');
      if (open) opened = { el };
    } else if (/^System(Db|Queue)?$/.test(base)) {
      const el: C4El = { alias: p0!, kind: 'software-system', label: p1 ?? p0!, ...((p2 ?? descr) ? { description: p2 ?? descr } : {}), ...(ext || tagged ? { external: true } : {}), children: [] };
      place(el, 'top');
      if (open) opened = { el };
    } else if (/^(Container|Component)(Db|Queue)?$/.test(base)) {
      const component = base.startsWith('Component');
      const variant = /Db$/.test(base) ? 'database' : /Queue$/.test(base) ? 'queue' : undefined;
      const technology = p2 ?? techn;
      const description = p3 ?? descr;
      const el: C4El = { alias: p0!, kind: component ? 'component' : (variant ?? containerKind(`${technology ?? ''} ${p1 ?? ''}`)), label: p1 ?? p0!, ...(technology ? { technology } : {}), ...(description ? { description } : {}), ...(ext || tagged ? { external: true } : {}), children: [] };
      place(el, component ? 'component' : 'container');
      if (open) opened = { el };
    } else if (base === 'System_Boundary') {
      const el: C4El = { alias: p0!, kind: 'software-system', label: p1 ?? p0!, children: [] };
      place(el, 'top');
      opened = { el };
    } else if (base === 'Container_Boundary') {
      const el: C4El = { alias: p0!, kind: 'container', label: p1 ?? p0!, children: [] };
      place(el, 'container');
      opened = { el };
    } else if (base === 'Enterprise_Boundary') {
      enterprise = p1 ?? p0;
      opened = { enterprise: enterprise! };
    } else if (base === 'Boundary') {
      // A boundary of its own type ("System", "Container") is that element; any other only groups.
      if (/^system$/i.test(p2 ?? a.named.type ?? '')) {
        const el: C4El = { alias: p0!, kind: 'software-system', label: p1 ?? p0!, children: [] };
        place(el, 'top');
        opened = { el };
      } else {
        warn.onceFor('boundary', 'Generic boundaries only group: their contents are kept, the boundary is not drawn');
        opened = { none: true };
      }
    } else if (/^(Deployment_Node|Node)(_L|_R)?$/.test(base)) {
      const node: DNode = { key: dIds.get(p0!, slug(p0!).toLowerCase()), label: p1 ?? p0!, ...((p2 ?? techn) ? { technology: p2 ?? techn } : {}), instances: [], nodes: [] };
      const up = stack.findLast((x) => 'node' in x) as { node: DNode } | undefined;
      (up && inNode() ? up.node.nodes : dnodes).push(node);
      opened = { node };
    } else if (/^(Bi)?Rel(Index)?(_\w+)?$/.test(macro!)) {
      const indexed = /^(Bi)?RelIndex/.test(macro!);
      const [from, to, label, technology] = indexed ? a.pos.slice(1) : a.pos;
      if (!from || !to) continue;
      rels.push({
        from, to,
        ...(label ? { label } : {}),
        ...((technology ?? techn) ? { technology: technology ?? techn } : {}),
        ...(/_Back$/.test(macro!) ? { back: true } : {}),
        ...(/^Bi/.test(macro!) ? { both: true } : {}),
        ...(indexed && Number.isFinite(Number(a.pos[0])) ? { index: Number(a.pos[0]) } : {}),
      });
    } else if (/^(Lay_|SHOW_|HIDE_|LAYOUT_|Add\w*Tag|Update\w*Style|Add\w*Property|AddProperty|SetPropertyHeader|WithoutPropertyHeader|increment|setIndex|RoundedBoxShape|EightSidedShape|DashedLine|DottedLine|BoldLine)/.test(macro!)) {
      if (/^(Add|Update)/.test(macro!)) warn.onceFor('c4style', 'Tags and styles (AddElementTag, UpdateElementStyle, …) are left out: the C4 look is built in');
      continue;
    } else warn.onceFor(`macro:${macro}`, `${macro}(…) is not imported`);
    if (open) stack.push(opened ?? { none: true });
  }
  if (!top.length) return (warn.add('No C4 elements found'), '');

  // The paths: an element's key under its parent, joined by dots.
  const pathOf = new Map<C4El, string>();
  const keys = (list: C4El[], prefix: string) => {
    for (const el of list) {
      const p = prefix + keyOf(el.alias, list);
      pathOf.set(el, p);
      keys(el.children, p + '.');
    }
  };
  keys(top, '');
  if (enterprise) for (const el of top) if (!el.inside && el.kind !== 'person') el.external ??= true;

  const out: Record<string, unknown> = { type: 'c4', title };
  const elementMap = (list: C4El[]): Record<string, unknown> =>
    Object.fromEntries(
      list.map((el) => [
        pathOf.get(el)!.split('.').at(-1)!,
        {
          kind: el.kind,
          label: clean(el.label),
          ...(el.technology ? { technology: clean(el.technology) } : {}),
          ...(el.description ? { description: clean(el.description) } : {}),
          ...(el.external ? { external: true } : {}),
          ...(el.children.length ? { elements: elementMap(el.children) } : {}),
        },
      ]),
    );
  out.elements = elementMap(top);

  const relationItem = (from: string, to: string, label?: string, technology?: string) => {
    const props = { ...(label ? { label: clean(label) } : {}), ...(technology ? { technology: clean(technology) } : {}) };
    const arrow = `${from} -> ${to}`;
    return Object.keys(props).length === 0 ? arrow : Object.keys(props).length === 1 && label ? { [arrow]: props.label } : { [arrow]: props };
  };
  const resolved = rels.flatMap((r) => {
    const [a, z] = [els.get(r.from), els.get(r.to)];
    if (!a || !z) return (warn.add(`Rel(${r.from}, ${r.to}): unknown element "${!a ? r.from : r.to}"`), []);
    if (r.both) warn.onceFor('birel', 'BiRel is drawn one way: write a second Rel for the way back');
    const [f, t] = r.back ? [z, a] : [a, z];
    return [{ ...r, from: pathOf.get(f)!, to: pathOf.get(t)! }];
  });

  // The view the PlantUML file draws: by its include, or by the deepest level it has.
  const level = (k: string) => includes.some((i) => new RegExp(`C4_${k}`, 'i').test(i));
  const all = [...els.values()];
  const containers = all.filter((e) => isContainer(e));
  const components = all.filter((e) => e.kind === 'component');
  const kind = level('Dynamic') ? 'dynamic' : level('Deployment') || dnodes.length ? 'deployment' : level('Component') ? 'component' : level('Container') ? 'container' : level('Context') ? 'context' : components.length ? 'component' : containers.length ? 'container' : 'context';
  const view: Record<string, unknown> = { kind };
  const systems = top.filter((e) => e.kind === 'software-system');
  const main = systems.find((e) => e.children.length && !e.external) ?? systems.find((e) => !e.external);
  if (kind === 'container' && main) view.of = pathOf.get(main);
  if (kind === 'component') {
    const c = containers.find((e) => e.children.some((x) => x.kind === 'component'));
    if (c) view.of = pathOf.get(c);
  }
  if (kind === 'context') {
    if (enterprise || systems.filter((e) => !e.external).length !== 1) {
      view.kind = 'landscape';
      if (enterprise) view.enterprise = clean(enterprise);
    } else view.of = pathOf.get(main!);
  }
  if (kind === 'dynamic') {
    const ordered = resolved.map((r, i) => ({ r, n: r.index ?? i + 1 })).sort((x, y) => x.n - y.n);
    view.steps = ordered.map(({ r }) => relationItem(r.from, r.to, r.label, r.technology));
  }
  if (kind === 'deployment') {
    const tree = (list: DNode[]): Record<string, unknown> =>
      Object.fromEntries(list.map((n) => [n.key, { label: clean(n.label), ...(n.technology ? { technology: clean(n.technology) } : {}), ...(n.instances.length ? { instances: n.instances.map((x) => pathOf.get(x)!) } : {}), ...(n.nodes.length ? { nodes: tree(n.nodes) } : {}) }]));
    view.nodes = tree(dnodes);
  }

  // Relations once per pair and label; a dynamic diagram's steps are relations of the model too.
  const seen = new Set<string>();
  const relations = resolved.filter((r) => !seen.has(`${r.from} ${r.to} ${r.label}`) && seen.add(`${r.from} ${r.to} ${r.label}`)).map((r) => relationItem(r.from, r.to, r.label, r.technology));
  if (relations.length) out.relations = relations;
  const viewKey = view.kind === 'landscape' ? 'landscape' : String(view.kind) === 'container' ? 'containers' : String(view.kind) === 'component' ? 'components' : String(view.kind);
  out.views = { [viewKey]: view };
  return c4Yaml(out);
}

const isContainer = (e: C4El) => ['container', 'database', 'queue', 'web-app', 'mobile-app', 'desktop-app', 'storage'].includes(e.kind);

function containerKind(words: string): string {
  const t = words.toLowerCase();
  if (/\b(mobile|ios|android|react native|flutter)\b/.test(t)) return 'mobile-app';
  if (/\b(spa|single-page|web ?app|frontend|react|angular|vue|svelte|next\.?js|browser)\b/.test(t)) return 'web-app';
  if (/\b(desktop|electron|wpf)\b/.test(t)) return 'desktop-app';
  if (/\b(s3|blob|bucket|object storage|file share)\b/.test(t)) return 'storage';
  return 'container';
}

// ---------------------------------------------------------------- state

function state(lines: string[], title: string, warn: Warnings): string {
  const body: string[] = [];
  for (const raw of lines) {
    let s = raw.replace(/\s+##?(\[[^\]]*\])?[\w#]*\s*/g, ' ').replace(/\s*<<(start|end|entrypoint|exitpoint|inputpin|outputpin|expansioninput|expansionoutput|sdlreceive)>>/gi, '').trim();
    if (/\[H\*?\]/.test(s)) warn.onceFor('history', 'History states ([H]) are drawn as plain states');
    s = s.replace(/\[H\*?\]/g, 'History');
    // Every arrow (->, -->, -down->, -[#red]->) as -->.
    s = s.replace(/\s*-+(?:\[[^\]]*\])?(?:left|right|up|down|le|ri|do|l|r|u|d)?-*>\s*/, ' --> ');
    s = s.replace(/^state\s+(\S+)\s+as\s+"([^"]+)"/, 'state "$2" as $1');
    let m: RegExpExecArray | null;
    if ((m = /^state\s+("[^"]+"|\S+)\s*:\s*(.*)$/.exec(s))) s = `${m[1]!.replace(/"/g, '')} : ${m[2]}`;
    if (/^\|\|$/.test(s)) s = '--';
    if (/^note\s+on\s+link/i.test(s)) {
      warn.onceFor('notelink', 'Notes on transitions are left out');
      continue;
    }
    body.push(s);
  }
  return importState(body, title, warn);
}

// ---------------------------------------------------------------- activity

function activity(lines: string[], title: string, warn: Warnings): string {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const lanes: { id: string; label: string }[] = [];
  const laneIds = new Ids();
  let lane: string | undefined;
  let tails: { node: string; label?: string }[] = [];
  let pending: string | undefined;
  let n = 0;
  type Block =
    | { kind: 'if'; decision: string; ends: { node: string; label?: string }[]; hasElse: boolean; elseLabel?: string }
    | { kind: 'while'; decision: string; out?: string }
    | { kind: 'repeat'; start?: string; startTails: { node: string; label?: string }[] }
    | { kind: 'fork'; split: string; ends: { node: string; label?: string }[]; join: 'parallel' }
    | { kind: 'switch'; decision: string; ends: { node: string; label?: string }[] };
  const blocks: Block[] = [];
  const add = (label: string, kind: FlowNode['kind'], bare = false): string => {
    const source = `n${++n}`;
    nodes.push({ source, label, kind, ...(lane ? { lane } : {}), ...(bare ? { bare } : {}) });
    for (const t of tails) links.push({ from: t.node, to: source, ...(t.label ?? pending ? { label: t.label ?? pending } : {}), message: false });
    pending = undefined;
    tails = [{ node: source }];
    // The first step after `repeat` is where the loop goes back to.
    const r = blocks.findLast((b) => b.kind === 'repeat') as Extract<Block, { kind: 'repeat' }> | undefined;
    if (r && !r.start) r.start = source;
    return source;
  };
  const question = (raw: string) => {
    const q = clean(raw.replace(/^\(|\)$/g, ''));
    return /\?$/.test(q) ? q : `${q}?`;
  };
  const label = (raw: string | undefined) => (raw ? clean(raw.replace(/^\(|\)$/g, '')) || undefined : undefined);

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i]!;
    let m: RegExpExecArray | null;
    if ((m = /^\|(?:#?[\w#]+\|)?([^|]+)\|$/.exec(s))) {
      const name = clean(m[1]!);
      const id = laneIds.get(name, slug(name).toLowerCase());
      if (!lanes.some((l) => l.id === id)) lanes.push({ id, label: name });
      lane = id;
    } else if (/^start$/i.test(s)) add('start', 'start');
    else if (/^(stop|end|kill|detach)$/i.test(s)) {
      if (/^(kill|detach)$/i.test(s)) warn.onceFor('detach', 'kill and detach end the flow, as stop does');
      add('end', 'end');
      tails = [];
    } else if ((m = /^(#\w+\s*)?:([\s\S]*)$/.exec(s))) {
      // :text; over one line or several, ended by ; | < > / ] or }.
      let text = m[2]!;
      while (!/[;|<>/\]}]\s*$/.test(text) && i + 1 < lines.length) text += ' ' + lines[++i]!;
      text = text.replace(/[;|<>/\]}]\s*$/, '');
      add(clean(text) || 'Step', 'task');
    } else if ((m = /^->\s*(.*?);?$/.exec(s))) pending = label(m[1]) ?? pending;
    else if ((m = /^if\s*(\(.*?\))\s*(?:is\s*(\(.*?\))\s*)?then\s*(\(.*?\))?\s*$/i.exec(s))) {
      const d = add(question(m[1]!), 'decision');
      blocks.push({ kind: 'if', decision: d, ends: [], hasElse: false });
      tails = [{ node: d, label: label(m[3] ?? m[2]) }];
    } else if ((m = /^(?:elseif|else\s+if)\s*(\(.*?\))\s*(?:is\s*(\(.*?\)))?\s*then\s*(\(.*?\))?\s*$/i.exec(s))) {
      const b = blocks.findLast((x) => x.kind === 'if') as Extract<Block, { kind: 'if' }> | undefined;
      if (!b) continue;
      b.ends.push(...tails);
      tails = [{ node: b.decision }];
      const d = add(question(m[1]!), 'decision');
      b.decision = d;
      tails = [{ node: d, label: label(m[3] ?? m[2]) }];
    } else if ((m = /^else\s*(\(.*?\))?\s*$/i.exec(s))) {
      const b = blocks.findLast((x) => x.kind === 'if') as Extract<Block, { kind: 'if' }> | undefined;
      if (!b) continue;
      b.ends.push(...tails);
      b.hasElse = true;
      tails = [{ node: b.decision, label: label(m[1]) }];
    } else if (/^end\s*if$/i.test(s)) {
      const b = blocks.pop();
      if (b?.kind !== 'if') continue;
      b.ends.push(...tails);
      if (!b.hasElse) b.ends.push({ node: b.decision });
      tails = b.ends;
    } else if ((m = /^while\s*(\(.*?\))\s*(?:is\s*(\(.*?\)))?\s*$/i.exec(s))) {
      const d = add(question(m[1]!), 'decision');
      blocks.push({ kind: 'while', decision: d });
      tails = [{ node: d, label: label(m[2]) }];
    } else if ((m = /^end\s*while\s*(\(.*?\))?\s*$/i.exec(s))) {
      const b = blocks.pop();
      if (b?.kind !== 'while') continue;
      for (const t of tails) links.push({ from: t.node, to: b.decision, ...(t.label ? { label: t.label } : {}), message: false });
      tails = [{ node: b.decision, label: label(m[1]) }];
    } else if (/^repeat$/i.test(s)) blocks.push({ kind: 'repeat', startTails: tails });
    else if ((m = /^repeat\s*while\s*(\(.*?\))\s*(?:is\s*(\(.*?\)))?\s*(?:not\s*(\(.*?\)))?\s*$/i.exec(s))) {
      const b = blocks.pop();
      if (b?.kind !== 'repeat') continue;
      const d = add(question(m[1]!), 'decision');
      if (b.start) links.push({ from: d, to: b.start, ...(label(m[2]) ? { label: label(m[2]) } : {}), message: false });
      tails = [{ node: d, label: label(m[3]) }];
    } else if (/^(fork|split)$/i.test(s)) {
      const p = add('Split', 'parallel', true);
      blocks.push({ kind: 'fork', split: p, ends: [], join: 'parallel' });
      tails = [{ node: p }];
    } else if (/^(fork|split)\s+again$/i.test(s)) {
      const b = blocks.findLast((x) => x.kind === 'fork') as Extract<Block, { kind: 'fork' }> | undefined;
      if (!b) continue;
      b.ends.push(...tails);
      tails = [{ node: b.split }];
    } else if (/^end\s*(fork|merge|split)\b/i.test(s)) {
      const b = blocks.pop();
      if (b?.kind !== 'fork') continue;
      b.ends.push(...tails);
      tails = b.ends;
      add('Join', 'parallel', true);
    } else if ((m = /^switch\s*(\(.*?\))\s*$/i.exec(s))) {
      const d = add(question(m[1]!), 'decision');
      blocks.push({ kind: 'switch', decision: d, ends: [] });
      tails = [];
    } else if ((m = /^case\s*(\(.*?\))\s*$/i.exec(s))) {
      const b = blocks.findLast((x) => x.kind === 'switch') as Extract<Block, { kind: 'switch' }> | undefined;
      if (!b) continue;
      b.ends.push(...tails);
      tails = [{ node: b.decision, label: label(m[1]) }];
    } else if (/^end\s*switch$/i.test(s)) {
      const b = blocks.pop();
      if (b?.kind !== 'switch') continue;
      b.ends.push(...tails);
      tails = b.ends;
    } else if (/^(partition|package|rectangle|card|group)\b.*\{?$/i.test(s) || s === '}' || /^end\s*group$/i.test(s)) warn.onceFor('partition', 'Partitions and groups are left out: their steps are kept');
    else if ((m = /^(floating\s+)?note\b(.*)$/i.exec(s))) {
      if (!m[2]!.includes(':')) {
        const j = lines.findIndex((l, k) => k > i && /^end\s*note$/i.test(l));
        if (j >= 0) i = j;
      }
      warn.onceFor('note', 'Notes are left out');
    } else if (/^(backward|break)\b/i.test(s)) warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
    else warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
  }
  if (!nodes.length) return (warn.add('No activity steps found'), '');
  return processYaml({ title, lanes, nodes, links });
}

// ---------------------------------------------------------------- entity

/** PlantUML entities become Mermaid erDiagram lines, which the erDiagram import knows. */
function er(lines: string[], title: string, warn: Warnings): string {
  const body: string[] = [];
  let open = false;
  for (const s of lines) {
    let m: RegExpExecArray | null;
    if (open) {
      if (s === '}') {
        body.push('}');
        open = false;
      } else if (/^(--+|\.\.+|==+|__+)$/.test(s)) continue;
      else if ((m = /^[*+#~-]?\s*([\w-]+)\s*(?::\s*([^<]*?))?\s*((?:<<\s*\w+\s*>>\s*)*)$/.exec(s))) {
        const keys = (m[3] ?? '').toUpperCase();
        const flags = [/<<\s*PK\s*>>/.test(keys) && 'PK', /<<\s*FK\s*>>/.test(keys) && 'FK', /<<\s*(UK|UNIQUE)\s*>>/.test(keys) && 'UK'].filter(Boolean);
        const type = (m[2] ?? '').trim().replace(/\s+/g, '_') || 'NOTYPE';
        body.push(`${type} ${m[1]} ${flags.join(', ')}`.trim());
      } else warn.add(`Could not read the attribute "${s}"`);
      continue;
    }
    if ((m = /^entity\s+(?:"([^"]+)"\s+as\s+(\w+)|(\w+)(?:\s+as\s+"([^"]+)")?)\s*(?:<<[^>]*>>)?\s*(?:#\w+)?\s*(\{)?$/.exec(s))) {
      const id = m[2] ?? m[3]!;
      const label = m[1] ?? m[4];
      body.push(`${id}${label ? `["${label}"]` : ''}${m[5] ? ' {' : ''}`);
      open = !!m[5];
      continue;
    }
    // Crow's feet as Mermaid writes them; direction words and colours in the line out.
    if ((m = /^(\w+)\s+([|}][o|]|[|]o)\s*(-+|\.+)(?:\w+(-+|\.+))?\s*([o|][|{]|o[|])\s+(\w+)\s*(?::\s*(.*))?$/.exec(s))) {
      body.push(`${m[1]} ${m[2]}${m[3]!.startsWith('.') ? '..' : '--'}${m[5]} ${m[6]}${m[7] ? ` : "${m[7].replace(/"/g, "'")}"` : ''}`);
      continue;
    }
    if ((m = /^(\w+)\s*(-+|\.+)>\s*(\w+)\s*(?::\s*(.*))?$/.exec(s))) {
      body.push(`${m[1]} }o${m[2]!.startsWith('.') ? '..' : '--'}|| ${m[3]}${m[4] ? ` : "${m[4]}"` : ''}`);
      continue;
    }
    warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
  }
  const yaml = importEr(body, title, warn);
  // An attribute without a type keeps none.
  return yaml.replace(/: "?NOTYPE ?([^"\n]*)"?$/gm, (_, rest: string) => `: ${rest ? scalar(rest) : '""'}`);
}
