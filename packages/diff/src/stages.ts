// Transitions between stages of one diagram (see packages/core/src/stages.ts): the compare view's
// overlay, side by side and plain sentences, on two stages of the same file. Both are drawn on the
// placement of everything, so what stays is exactly where it was and what went is a ghost in its place.
import { render, type RenderOptions, type RenderResult } from '@cartography/engine';
import type { StageInfo } from '@cartography/core';
import { compare, type Comparison } from './compare.ts';
import { explain, type Explained } from './explain.ts';

export interface StageComparison extends Comparison {
  from: StageInfo;
  to: StageInfo;
  /** What replaces what between the two stages (old id → new id). */
  replaces: { from: string; to: string }[];
  /** The changes in sentences, a replacement told as one. */
  told: Explained[];
}

/** The stages of a diagram, from a render of it; undefined when it has none. */
export async function stagesOf(text: string, opts: RenderOptions = {}): Promise<StageInfo[] | undefined> {
  return (await render(text, { fonts: 'none', ...opts, stage: undefined })).stages;
}

/** Stage `a` against stage `b` (ids, numbers or titles). Undefined when the diagram has no such stages. */
export async function compareStages(text: string, a: string | number, b: string | number, opts: RenderOptions = {}): Promise<StageComparison | undefined> {
  const base = { fonts: 'none' as const, ...opts };
  const before = await render(text, { ...base, stage: a });
  const list = before.stages;
  if (!list) return undefined;
  const c = await compare(text, text, { before: { ...base, stage: a }, after: { ...base, stage: b }, drawnBefore: before });
  const from = list.find((s) => s.id === c.before?.stage);
  const to = list.find((s) => s.id === c.after?.stage);
  if (!from || !to) return undefined;
  const [i, j] = [list.indexOf(from), list.indexOf(to)];
  const [lo, hi] = i <= j ? [i, j] : [j, i];
  // Replacements of every stage on the way (forwards), only where both ends show the change.
  const replaces = list
    .slice(lo + 1, hi + 1)
    .flatMap((s) => s.replaced)
    .map((r) => (i <= j ? r : { from: r.to, to: r.from }))
    .filter((r) => c.diff.nodes.some((n) => n.id === r.from && n.status === 'removed') && c.diff.nodes.some((n) => n.id === r.to && n.status === 'added'));
  const told = tellReplaced(explain(c.diff, c.before?.graph, c.after?.graph), replaces, c.before, c.after);
  return {
    ...c,
    from,
    to,
    replaces,
    told,
    picture: (o) => c.picture({ against: from.title, replaces, ...o }),
    sideBySide: (o) => c.sideBySide({ labels: { before: from.title, after: to.title }, ...o }),
  };
}

/** The removal of the old and the addition of the new, told as one sentence: "Replaced File server by File shares". */
export function tellReplaced(told: Explained[], all: { from: string; to: string }[], before?: RenderResult, after?: RenderResult): Explained[] {
  // Only where the one went and the other came in this comparison.
  const said = (id: string, status: string) => told.some((t) => t.item?.kind === 'node' && t.item.id === id && t.item.status === status);
  const pairs = all.filter((p) => said(p.from, 'removed') && said(p.to, 'added'));
  if (!pairs.length) return told;
  const byNew = new Map<string, string[]>();
  for (const p of pairs) byNew.set(p.to, [...(byNew.get(p.to) ?? []), p.from]);
  const gone = new Set(pairs.flatMap((p) => [p.from, p.to]));
  const out: Explained[] = [];
  let done = false;
  for (const x of told) {
    const id = x.item?.kind === 'node' ? x.item.id : undefined;
    if (id && gone.has(id) && x.item!.status !== 'changed') {
      if (!done) {
        for (const [to, froms] of byNew) {
          const pair = replacedNames(froms, to, before, after);
          const list = pair.olds.length > 1 ? `${pair.olds.slice(0, -1).join(', ')} and ${pair.olds.at(-1)}` : pair.olds[0];
          const where = after?.graph?.groups.find((g) => g.id === after.graph!.nodes.find((n) => n.id === to)?.parent)?.label;
          out.push({ text: `Replaced ${list} by ${pair.now}${where ? ` in ${where}` : ''}`, item: told.find((t) => t.item?.id === to)?.item });
        }
        done = true;
      }
      continue;
    }
    out.push(x);
  }
  return out;
}

/** The names of what is replaced and what replaces it; with the same name both say what they are: "Order service (Virtual machine)". */
function replacedNames(froms: string[], to: string, before?: RenderResult, after?: RenderResult): { olds: string[]; now: string } {
  const shape = (r: RenderResult | undefined, id: string) => {
    const n = r?.graph?.nodes.find((x) => x.id === id);
    const s = n?.shape as { label?: string; title?: string; caption?: string } | undefined;
    return { name: s?.label || s?.title || id, what: s?.caption };
  };
  const now = shape(after, to);
  const olds = froms.map((f) => shape(before, f));
  const same = olds.some((o) => o.name === now.name);
  const say = (x: { name: string; what?: string }) => (same && x.what ? `${x.name} (${x.what})` : x.name);
  return { olds: olds.map(say), now: say(now) };
}

/** Each stage after the first against the one before it: what it changes, in sentences. */
export async function stageStory(text: string, opts: RenderOptions = {}): Promise<{ stage: StageInfo; told: Explained[] }[]> {
  const list = await stagesOf(text, opts);
  if (!list) return [];
  const out: { stage: StageInfo; told: Explained[] }[] = [{ stage: list[0]!, told: [] }];
  for (let k = 1; k < list.length; k++) {
    const c = await compareStages(text, list[k - 1]!.id, list[k]!.id, opts);
    out.push({ stage: list[k]!, told: c?.told ?? [] });
  }
  return out;
}

/** The story of the stages as Markdown: per stage its title, when, description and what it changes. */
export function storyMarkdown(title: string, story: { stage: StageInfo; told: Explained[] }[]): string {
  const lines = [`# ${title}`, ''];
  for (const [k, { stage, told }] of story.entries()) {
    lines.push(`## ${stage.title}${stage.when ? ` (${stage.when})` : ''}`, '');
    if (stage.description) lines.push(stage.description, '');
    if (k === 0) lines.push('The starting point.', '');
    else if (!told.length) lines.push('Nothing changes in what is drawn.', '');
    else lines.push(...told.map((t) => `- ${t.text}`), '');
  }
  return lines.join('\n');
}

export interface RoadmapOptions {
  /** Lanes from the outermost group of each element (default), or from its first tag. */
  lanes?: 'groups' | 'tags';
  /** Title of the roadmap; by default the diagram's, with "roadmap". */
  title?: string;
}

const QUARTER = /^\d{4}-Q[1-4]$/i;
const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A roadmap (type: roadmap) made from the stages: a lane per group (or tag), an item per change of a
 * stage ("Add Hub firewall", "File server → File shares", "Retire Backup tapes"), and a phase per
 * stage. With a date or quarter on every stage the axis is time; else the stages are its periods.
 */
export async function stagesRoadmap(text: string, opts: RenderOptions = {}, how: RoadmapOptions = {}): Promise<string | undefined> {
  const { Document } = await import('yaml');
  const whole = await render(text, { fonts: 'none', ...opts, stage: 'overview' });
  const list = whole.stages;
  if (!list || list.length < 2 || !whole.graph) return undefined;
  const g = whole.graph;
  const groups = new Map(g.groups.map((x) => [x.id, x]));
  const top = (id: string): string | undefined => {
    let at = g.nodes.find((n) => n.id === id)?.parent ?? (groups.has(id) ? id : undefined);
    while (at && groups.get(at)?.parent) at = groups.get(at)!.parent;
    return at;
  };
  const laneOf = (id: string): string => {
    if (how.lanes === 'tags') return (g.nodes.find((n) => n.id === id)?.tags ?? groups.get(id)?.tags ?? [])[0] ?? 'other';
    return top(id) ?? 'other';
  };
  const dated = list.every((s) => s.when && (QUARTER.test(s.when) || MONTH.test(s.when) || DAY.test(s.when)));
  const items: Record<string, Record<string, unknown>> = {};
  const lanes = new Map<string, string>();
  const phases: Record<string, Record<string, unknown>> = {};
  const used = new Set<string>();
  const key = (s: string) => {
    let k = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
    for (let n = 2; used.has(k); n++) k = `${k.replace(/-\d+$/, '')}-${n}`;
    used.add(k);
    return k;
  };
  for (let k = 1; k < list.length; k++) {
    const s = list[k]!;
    const c = await compareStages(text, list[k - 1]!.id, s.id, opts);
    if (!c) continue;
    const when = dated ? (DAY.test(s.when!) ? { from: list[k - 1]!.when, to: s.when } : { in: s.when }) : { in: s.title };
    phases[s.title] = dated ? (DAY.test(s.when!) ? { from: list[k - 1]!.when, to: s.when } : { in: s.when }) : { in: s.title };
    const name = (r: RenderResult | undefined, id: string) => {
      const n = r?.graph?.nodes.find((x) => x.id === id);
      return (n?.shape as { label?: string } | undefined)?.label || r?.graph?.groups.find((x) => x.id === id)?.label || id;
    };
    const done = new Set<string>();
    const add = (id: string, label: string) => {
      const lane = laneOf(id);
      if (!lanes.has(lane)) lanes.set(lane, groups.get(lane)?.label ?? (lane === 'other' ? 'Other' : lane));
      items[key(`${s.id}-${label}`)] = { lane, label, ...when, status: 'planned' };
    };
    for (const r of c.replaces) {
      if (done.has(r.to)) continue;
      // A bar has room for a few words: the old and the new, or what the new one is.
      const froms = c.replaces.filter((x) => x.to === r.to).map((x) => x.from);
      const [old, now] = [name(c.before, froms[0]!), name(c.after, r.to)];
      const what = (c.after?.graph?.nodes.find((x) => x.id === r.to)?.shape as { caption?: string } | undefined)?.caption;
      const label = froms.length > 1 ? `${now} replaces ${froms.length}` : old === now ? `${now} to ${what ?? 'new'}` : `${old} → ${now}`;
      add(r.to, label.length > 34 ? `Replace ${old}` : label);
      done.add(r.to);
      for (const x of c.replaces) if (x.to === r.to) done.add(x.from);
    }
    // What goes with its group is part of the group's retirement.
    const gone = new Set(c.diff.groups.filter((i) => i.status === 'removed').map((i) => i.id));
    const parentOf = (id: string) => c.before?.graph?.nodes.find((n) => n.id === id)?.parent ?? c.before?.graph?.groups.find((x) => x.id === id)?.parent;
    for (const i of [...c.diff.groups, ...c.diff.nodes]) {
      if (done.has(i.id) || (i.status === 'removed' && gone.has(parentOf(i.id) ?? ''))) continue;
      const side = i.status === 'removed' ? c.before : c.after;
      add(i.id, `${i.status === 'added' ? 'Add' : i.status === 'removed' ? 'Retire' : 'Change'} ${name(side, i.id)}`);
    }
  }
  const first = list[0]!.when!;
  const last = list.at(-1)!.when!;
  const source = {
    type: 'roadmap',
    title: how.title ?? `${g.title ?? 'Migration'} roadmap`,
    subtitle: `${list.length - 1} stages from ${list[0]!.title} to ${list.at(-1)!.title}, made from the stages of the diagram`,
    ...(dated ? { from: list[1]!.when && !DAY.test(first) ? list[1]!.when : first, to: last, unit: list.some((s) => QUARTER.test(s.when!)) ? 'quarter' : 'month' } : { periods: list.slice(1).map((s) => s.title) }),
    lanes: Object.fromEntries(lanes),
    phases,
    items,
  };
  const doc = new Document(source);
  for (const path of [['phases'], ['items']]) {
    const m = doc.getIn(path, true) as { items?: { value?: { flow?: boolean } }[] } | undefined;
    for (const p of m?.items ?? []) if (p.value) p.value.flow = true;
  }
  return `# Made by carto from the stages of the diagram: edit the stages there, or this roadmap on its own.\n${doc.toString({ lineWidth: 0, flowCollectionPadding: true })}`;
}

/** The story in plain sentences, a paragraph per stage: "In Landing zone (2026-Q2) the File server and … are replaced by …". */
export function storyText(title: string, story: { stage: StageInfo; told: Explained[] }[]): string {
  // Only the verb is lowered: a name stays as the drawing writes it.
  const lower = (s: string) => (/^(Added|Removed|Replaced|Moved|Renamed|Titled|Subtitle) /.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
  const out = [title, ''];
  for (const [k, { stage, told }] of story.entries()) {
    const when = `${stage.title}${stage.when ? ` (${stage.when})` : ''}`;
    const said = told.map((t, i) => (i ? lower(t.text) : t.text));
    out.push(k === 0 ? `${when} is where it starts.${stage.description ? ` ${stage.description}` : ''}` : `In ${when}: ${said.length ? `${said.join('; ')}.` : 'nothing changes in what is drawn.'}${stage.description ? ` ${stage.description}` : ''}`, '');
  }
  return out.join('\n');
}
