// Stages in the editor: a timeline strip under the drawing (Overview · As-is · Q2 · To-be) to look at
// each stage, ← → on it or , and . on the drawing to walk them, and editing in the context of a stage:
// what is added while a stage is picked comes in that stage (its add: list), Delete records that it
// goes there (remove:). The overview is the whole file as written, edited as usual. "Compare stages…"
// opens the compare view on two stages; "Make roadmap" opens the roadmap the stages make.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Path, StageInfo } from '@cartography/core';
import type { RenderResult } from '@cartography/engine';
import { Icon } from '../icon.tsx';
import { is, keyHint } from '../keys.ts';
import { say } from './strings.ts';
import { listed, recordIn, tidyStages } from './stages-edit.ts';
import './stages.css';

interface Asked {
  doc: string;
  view?: string;
  stage: string;
}

export interface StageCommand {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: string;
  shortcut?: string;
  run(): void;
}

interface Selected {
  kind: 'node' | 'group' | 'edge';
  id: string;
}

export interface StagesContext {
  drawn?: RenderResult;
  textNow(): string;
  apply(next: string | undefined): void;
  notify(message: string, opts?: { tone?: 'error' }): void;
  /** Opens the compare view with stage `from` as the before and `to` as the after. */
  compare(from: StageInfo, to: StageInfo, replaces: { from: string; to: string }[]): void;
  /** Opens a new document (the roadmap). */
  openDoc(text: string, name: string, said: string): void;
  /** The document's name, for the roadmap's file name. */
  name: string;
}

/** The stage asked for in this document and view (its id or "overview"): `options` goes to the render. */
export function useStages(doc: string, view: string | undefined) {
  const [asked, setAsked] = useState<Asked>();
  const mine = asked && asked.doc === doc && asked.view === view ? asked.stage : undefined;
  const options = useMemo(() => (mine ? { stage: mine } : undefined), [mine]);
  const pick = (stage: string) => setAsked({ doc, view, stage });
  return { options, ui: (ctx: StagesContext) => stagesUi(ctx, pick) };
}

function stagesUi(ctx: StagesContext, pick: (stage: string) => void) {
  const list = ctx.drawn?.stages ?? [];
  const at = ctx.drawn?.stage;
  const k = list.findIndex((s) => s.id === at);
  const go = (i: number) => {
    const n = Math.max(-1, Math.min(list.length - 1, i));
    pick(n < 0 ? 'overview' : list[n]!.id);
  };
  /** Replacements on the way from a to b, as the transition draws them. */
  const replaces = (a: number, b: number) => list.slice(Math.min(a, b) + 1, Math.max(a, b) + 1).flatMap((s) => s.replaced);
  const compare = (a = k > 0 ? k - 1 : 0, b = k > 0 ? k : list.length - 1) => list[a] && list[b] && ctx.compare(list[a]!, list[b]!, replaces(a, b));
  const roadmap = async () => {
    const { stagesRoadmap } = await import('@cartography/diff');
    const text = await stagesRoadmap(ctx.textNow(), { fonts: 'none' });
    if (!text) return ctx.notify(say.roadmapNone);
    const name = `${ctx.name.replace(/\.ya?ml$/i, '')}-roadmap.yaml`;
    ctx.openDoc(text, name, say.roadmapOpened(name));
  };
  const selector = (s: Selected) => {
    if (s.kind !== 'edge') return s.id;
    const e = ctx.drawn?.graph?.edges.find((x) => x.id === s.id);
    return e ? `${e.from.node} -> ${e.to.node}` : undefined;
  };
  const name = (s: Selected) => {
    const n = ctx.drawn?.graph?.nodes.find((x) => x.id === s.id)?.shape as { label?: string } | undefined;
    return n?.label ?? ctx.drawn?.graph?.groups.find((g) => g.id === s.id)?.label ?? selector(s) ?? s.id;
  };

  const commands: StageCommand[] = !list.length
    ? []
    : [
        { id: 'stage-overview', group: say.group, label: say.showOverview, icon: 'layers', run: () => go(-1) },
        ...list.map((s, i) => ({ id: `stage:${s.id}`, group: say.group, label: say.show(s.title), ...(s.when ? { hint: s.when } : {}), icon: 'layers', run: () => go(i) })),
        { id: 'stage-next', group: say.group, label: say.next, icon: 'layers', shortcut: '.', run: () => go(k + 1) },
        { id: 'stage-previous', group: say.group, label: say.previous, icon: 'layers', shortcut: ',', run: () => go(k - 1) },
        ...list.flatMap((s, i) => (i ? [{ id: `stage-compare:${i}`, group: say.group, label: `${say.compare.replace('…', '')}: ${list[i - 1]!.title} → ${s.title}`, icon: 'clock', run: () => compare(i - 1, i) }] : [])),
        ...(list.length > 2 ? [{ id: 'stage-compare-ends', group: say.group, label: `${say.compare.replace('…', '')}: ${list[0]!.title} → ${list.at(-1)!.title}`, icon: 'clock', run: () => compare(0, list.length - 1) }] : []),
        { id: 'stage-roadmap', group: say.group, label: say.roadmap, hint: say.roadmapTitle, icon: 'calendar', run: () => void roadmap() },
      ];

  return {
    active: list.length > 0,
    commands,
    /** , and . on the drawing: the previous and next stage. */
    onKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
      if (!list.length || !is(e, 'stage-by')) return false;
      go(k + (e.key === '.' ? 1 : -1));
      return true;
    },
    /** An element just added: while a later stage is picked, it comes in that stage. */
    onAdd(text: string, path: Path): string {
      if (k < 1 || path.length !== 2) return text;
      const id = String(path[1]);
      const next = recordIn(text, k, 'add', id);
      if (next) ctx.notify(say.addedIn(id, list[k]!.title));
      return next ?? text;
    },
    /**
     * Deleting while a later stage is picked records that the selection goes in that stage, unless
     * one of them only comes in this stage (then it is deleted, and the stage forgets it).
     */
    onRemove(sel: Selected[]): boolean {
      if (k < 1 || !sel.length) return false;
      const text = ctx.textNow();
      const sels = sel.map(selector);
      if (sels.some((s) => !s || listed(text, k, 'add', s))) return false;
      let next: string | undefined = text;
      for (const s of sels) next = next && recordIn(next, k, 'remove', s!);
      ctx.apply(next);
      if (next) ctx.notify(say.removedIn(sel.length === 1 ? name(sel[0]!) : `${sel.length} elements`, list[k]!.title));
      return true;
    },
    /** A deletion's text with the stages tidied: nothing left naming what is gone. */
    tidy: (text: string | undefined) => (text == null ? text : tidyStages(text)),
    strip: list.length ? <StagesStrip list={list} at={k} onPick={go} onCompare={() => compare()} onRoadmap={() => void roadmap()} /> : null,
  };
}

function StagesStrip({ list, at, onPick, onCompare, onRoadmap }: { list: StageInfo[]; at: number; onPick(i: number): void; onCompare(): void; onRoadmap(): void }) {
  const row = useRef<HTMLDivElement>(null);
  const chip = (i: number) => row.current?.querySelector<HTMLElement>(`[data-stage-index="${i}"]`);
  useEffect(() => {
    chip(at)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [at]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const to = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'Home' ? -1 : e.key === 'End' ? list.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    const n = Math.max(-1, Math.min(list.length - 1, to));
    onPick(n);
    requestAnimationFrame(() => chip(n)?.focus());
  };
  const editing = at < 0 ? say.editingAll : at === 0 ? say.editingFirst(list[0]!.title) : say.editingIn(list[at]!.title);
  return (
    <div className="steps-strip stages-strip" role="toolbar" aria-label={say.strip}>
      <span className="steps-title">
        <Icon name="calendar" size={14} /> {say.strip}
      </span>
      <div className="steps-row stages-row" ref={row}>
        <button className={at < 0 ? 'step-chip active' : 'step-chip'} data-stage-index={-1} aria-pressed={at < 0} title={say.overviewTitle} onClick={() => onPick(-1)} onKeyDown={(e) => onKey(e, -1)}>
          {say.overview}
        </button>
        {list.map((s, i) => (
          <span key={s.id} className="stage-stop">
            <span className={i <= at ? 'stage-line done' : 'stage-line'} aria-hidden="true" />
            <button
              className={i === at ? 'step-chip stage-chip active' : 'step-chip stage-chip'}
              data-stage-index={i}
              data-stage={s.id}
              aria-pressed={i === at}
              aria-label={say.stageTitle(s.title, s.when)}
              title={say.stageTitle(s.title, s.when, s.description)}
              onClick={() => onPick(i)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className={i === at ? 'stage-dot on' : i < at ? 'stage-dot past' : 'stage-dot'} aria-hidden="true" />
              <span>{s.title}</span>
              {s.when && <small>{s.when}</small>}
            </button>
          </span>
        ))}
      </div>
      <span className="stages-editing" title={editing}>
        {editing}
      </span>
      <button className="step-chip add" onClick={onCompare} title={say.compareTitle}>
        <Icon name="clock" size={14} /> {say.compare}
      </button>
      <button className="step-chip add" onClick={onRoadmap} title={say.roadmapTitle}>
        <Icon name="calendar" size={14} /> {say.roadmap}
      </button>
      <span className="steps-keys" aria-hidden="true">
        <kbd>,</kbd> <kbd>.</kbd> {say.keys}
      </span>
    </div>
  );
}

export { keyHint };
