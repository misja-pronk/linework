// Architecture decisions in the editor: the Decisions panel (list, filter by status, read and edit a
// decision with a preview, new decision about the selection, link and unlink, supersede) and the
// numbered page markers on the drawing while the panel is open. Everything the editor (app.tsx) has
// to give is in DecisionHost; what it gets back is in useDecisionsTool's result.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  concernFor,
  decisionStands,
  decisionStatuses,
  decisionSummary,
  decisionsAbout,
  decisionsOnDrawing,
  elementAt,
  markdownBlocks,
  readConcern,
  resolveConcern,
  statusLabel,
  statusSaid,
  type Decision,
  type DecisionStatus,
  type Inline,
  type MdBlock,
  type WorkspaceIndex,
} from '@cartography/core';
import { decisionLook, decisionSpots, targetName, type DrawingAt, type RenderResult } from '@cartography/engine';
import type { Command } from './palette.tsx';
import type { Workspace } from './files.ts';
import { Icon } from './icon.tsx';
import { store } from './store.ts';
import { keyHint } from './keys.ts';
import { useDecisions, type Decisions } from './decisions-state.ts';
import './decisions.css';

type Sel = { kind: 'node' | 'group' | 'edge'; id: string };
export type DecisionFilter = 'standing' | 'proposed' | 'accepted' | 'history' | 'all';
const FILTERS: [DecisionFilter, string][] = [
  ['standing', 'Standing'],
  ['proposed', 'Proposed'],
  ['accepted', 'Accepted'],
  ['history', 'History'],
  ['all', 'All'],
];
const passes = (d: Decision, f: DecisionFilter) => (f === 'all' ? true : f === 'standing' ? decisionStands(d) : f === 'history' ? !decisionStands(d) : d.status === f);

export interface DecisionHost {
  ws?: Workspace;
  index: WorkspaceIndex;
  /** The open document: its path in the folder, or its name (as the workspace index knows it). */
  file: string;
  drawn?: RenderResult;
  selected?: Sel;
  selection: Sel[];
  select(s: Sel): void;
  zoomToSelection(): void;
  focusDrawing(): void;
  refresh(ws: Workspace): void;
  notify(message: string, o?: { tone?: 'error' }): void;
  /** Whether the panel is open: the editor's, as it lays out the side panel. */
  open: boolean;
  setOpen(open: boolean): void;
}

/** The page marker of a decision, as on paper: filled accepted, dashed proposed, struck through the rest. */
export function DecisionMark({ n, status }: { n: number | string; status: DecisionStatus }) {
  const look = decisionLook(status);
  const w = Math.max(17, String(n).length * 6.4 + 10);
  const h = 19;
  return (
    <svg className={`adr-mark ${look}`} width={w} height={h} viewBox={`-1 -1 ${w + 2} ${h + 2}`} aria-hidden="true">
      <path className="page" d={`M0 0H${w - 5}L${w} 5V${h}H0Z`} />
      <path className="fold" d={`M${w - 5} 0V5H${w}`} />
      <text x={(w - 2) / 2} y={h / 2 + 4.5} textAnchor="middle">
        {n}
      </text>
      {look === 'struck' && <path className="strike" d={`M-1 ${h - 3}L${w + 1} 3`} />}
    </svg>
  );
}

function Parts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        const inner = p.code ? <code key={i}>{p.text}</code> : p.bold ? <strong key={i}>{p.text}</strong> : p.italic ? <em key={i}>{p.text}</em> : <span key={i}>{p.text}</span>;
        return p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noreferrer noopener">
            {inner}
          </a>
        ) : (
          inner
        );
      })}
    </>
  );
}

/** A decision's markdown as it reads: headings, paragraphs, lists, quotes, code. */
export function DecisionText({ blocks }: { blocks: MdBlock[] }) {
  return (
    <div className="adr-text">
      {blocks.map((b, i) =>
        b.kind === 'heading' ? (
          b.level <= 2 ? (
            <h3 key={i}>
              <Parts parts={b.parts} />
            </h3>
          ) : (
            <h4 key={i}>
              <Parts parts={b.parts} />
            </h4>
          )
        ) : b.kind === 'list' ? (
          b.ordered ? (
            <ol key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Parts parts={it} />
                </li>
              ))}
            </ol>
          ) : (
            <ul key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Parts parts={it} />
                </li>
              ))}
            </ul>
          )
        ) : b.kind === 'code' ? (
          <pre key={i}>{b.text}</pre>
        ) : b.kind === 'quote' ? (
          <blockquote key={i}>
            <Parts parts={b.parts} />
          </blockquote>
        ) : b.kind === 'rule' ? (
          <hr key={i} />
        ) : (
          <p key={i}>
            <Parts parts={b.parts} />
          </p>
        ),
      )}
    </div>
  );
}

/** What the open document shows of a decision's concerns, and how it reads them. */
function useDrawing(h: DecisionHost) {
  const view = h.drawn?.view;
  const shows = h.index.shows.get(view ? `${h.file}#${view}` : h.file);
  const at: DrawingAt = { file: h.file, view, drawnAs: (id) => shows?.get(id) };
  /** A drawn id as the model knows it (deployment's "engine" is payments.engine). */
  const modelId = (node: string) => elementAt(h.index, h.file, view, node);
  return { at, modelId };
}

export function useDecisionsTool(h: DecisionHost) {
  const decisions: Decisions = useDecisions(h.ws, h.index, h);
  const { open, setOpen } = h;
  const [active, setActive] = useState<number>();
  const [filter, setFilter] = useState<DecisionFilter>(() => store.get<DecisionFilter>('decision-filter') ?? 'all');
  const [onlySelection, setOnlySelection] = useState(false);
  /** A new decision being named: what it is about, and what it supersedes. */
  const [draft, setDraft] = useState<{ concerns: string[]; supersedes?: number }>();
  const [withExports, setWithExports] = useState(() => store.get<boolean>('decisions-in-exports') ?? false);
  useEffect(() => store.set('decision-filter', filter), [filter]);
  const { at, modelId } = useDrawing(h);
  const graph = h.drawn?.graph;

  /** The selection as concerns: model ids where the folder knows them. */
  const selectionConcerns = (): string[] => (graph ? h.selection.map((s) => concernFor(graph, s.kind, s.id, modelId)).filter((c): c is string => !!c) : []);

  const show = (n?: number) => {
    setOpen(true);
    setActive(n);
  };
  const newAbout = (supersedes?: number) => {
    const old = supersedes ? decisions.get(supersedes) : undefined;
    setDraft({ concerns: old ? old.concerns : selectionConcerns(), ...(old ? { supersedes } : {}) });
    setOpen(true);
    setActive(undefined);
  };
  const toggle = () => {
    if (open) return close();
    // Opened with something selected: its decisions first.
    setOnlySelection(!!h.selected && !!graph && decisionsAbout(decisions.list, concernFor(graph, h.selected.kind, h.selected.id, modelId) ?? '').length > 0);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setDraft(undefined);
    h.focusDrawing();
  };
  const goTo = (concern: string) => {
    if (!graph) return;
    const t = resolveConcern(concern, graph, at);
    if (!t || t.kind === 'view') return h.notify(t ? 'That is this view' : `${concern} is not in this drawing`);
    h.select(t);
    requestAnimationFrame(() => h.zoomToSelection());
  };
  const setExports = (on: boolean) => {
    store.set('decisions-in-exports', on);
    setWithExports(on);
  };

  const commands: Command[] = [
    { id: 'decisions', group: 'Decisions', label: open ? 'Hide the decisions' : 'Show the decisions', hint: `${decisions.list.length} in ${decisions.inFolder ? decisions.dir + '/' : 'this browser'}`, icon: 'scroll-text', shortcut: keyHint('decisions'), run: toggle },
    { id: 'decision-new', group: 'Decisions', label: h.selection.length ? 'New decision about the selection…' : 'New decision…', hint: 'the next number, from the template', icon: 'file-plus', shortcut: keyHint('decision-new'), run: () => newAbout() },
    { id: 'decisions-export', group: 'Decisions', label: withExports ? 'Exports without decisions' : 'Exports with decisions', hint: 'markers, a key and the decisions under the drawing', icon: 'download', run: () => setExports(!withExports) },
    ...decisions.list.map((d) => ({ id: `decision-${d.number}`, group: 'Decisions', label: `${d.number}. ${d.title}`, hint: statusSaid(d), icon: 'scroll-text', run: () => show(d.number) })),
  ];

  const markers = (scale: number): ReactNode => {
    const r = h.drawn;
    if (!open || !r?.graph || !r.placed || !decisions.list.length) return null;
    const o = r.origin ?? { x: 0, y: 0 };
    return decisionSpots(decisions.list, r.graph, r.placed, at, { width: r.width ?? 0 }).map((s, i) => {
      const p = s.target.kind === 'view' ? s.at : { x: s.at.x + o.x, y: s.at.y + o.y };
      const d = s.decision;
      return (
        <button
          key={`${d.number}:${i}`}
          className={`decision-marker${active === d.number ? ' active' : ''}`}
          data-decision={d.number}
          style={{ left: p.x, top: p.y, transform: `scale(${1 / scale})` }}
          aria-label={`Decision ${d.number}, ${statusSaid(d)}: ${d.title}, about ${s.about}`}
          title={`${d.number}. ${d.title} (${statusSaid(d)})`}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            show(d.number);
          }}
        >
          <DecisionMark n={d.number} status={d.status} />
        </button>
      );
    });
  };

  /** For "where is this used": the decisions about an element of the model. */
  const whereSection = (element: string): ReactNode => {
    const list = decisionsAbout(decisions.list, element);
    if (!list.length) return null;
    return (
      <>
        <h4>Decisions {list.length}</h4>
        {list.map((d) => (
          <button key={d.number} className="where-row" onClick={() => show(d.number)} title={`Open decision ${d.number}`}>
            <DecisionMark n={d.number} status={d.status} />
            <span>{d.title}</span>
            <span className="where-as">{statusLabel[d.status].toLowerCase()}</span>
          </button>
        ))}
      </>
    );
  };

  const panel: ReactNode = open ? (
    <DecisionsPanel
      host={h}
      decisions={decisions}
      at={at}
      active={active}
      onActive={setActive}
      filter={filter}
      onFilter={setFilter}
      onlySelection={onlySelection}
      onOnlySelection={setOnlySelection}
      selectionConcerns={selectionConcerns()}
      draft={draft}
      onDraft={setDraft}
      onNew={newAbout}
      onGo={goTo}
      withExports={withExports}
      onWithExports={setExports}
      onClose={close}
    />
  ) : null;

  /** What an export with decisions draws: the decisions, and where this drawing has them. */
  const forExport = withExports && decisions.list.length ? { list: decisions.list, at: (view?: string) => ({ ...at, view, drawnAs: (id: string) => h.index.shows.get(view ? `${h.file}#${view}` : h.file)?.get(id) }) } : undefined;

  return { decisions, open, toggle, close, show, newAbout, commands, markers, panel, whereSection, forExport, count: decisions.list.length };
}

interface PanelProps {
  host: DecisionHost;
  decisions: Decisions;
  at: DrawingAt;
  active?: number;
  onActive(n: number | undefined): void;
  filter: DecisionFilter;
  onFilter(f: DecisionFilter): void;
  onlySelection: boolean;
  onOnlySelection(on: boolean): void;
  selectionConcerns: string[];
  draft?: { concerns: string[]; supersedes?: number };
  onDraft(d: { concerns: string[]; supersedes?: number } | undefined): void;
  onNew(supersedes?: number): void;
  onGo(concern: string): void;
  withExports: boolean;
  onWithExports(on: boolean): void;
  onClose(): void;
}

function DecisionsPanel(p: PanelProps) {
  const { decisions } = p;
  const graph = p.host.drawn?.graph;
  const here = useMemo(() => (graph ? new Set(decisionsOnDrawing(decisions.list, graph, p.at).map((x) => x.decision.number)) : new Set<number>()), [decisions.list, graph, p.at.view]);
  const sel = p.selectionConcerns;
  const about = (d: Decision) => sel.some((c) => d.concerns.includes(c) || decisionsAbout([d], c).length > 0);
  const shown = decisions.list.filter((d) => passes(d, p.filter)).filter((d) => !p.onlySelection || about(d));
  const opened = p.active !== undefined ? decisions.get(p.active) : undefined;
  const selName = graph && p.host.selected ? targetName(p.host.selected, graph) : sel.length > 1 ? `${sel.length} selected` : undefined;

  return (
    <aside className="inspector decisions-panel" aria-label="Decisions">
      <header>
        <span className="inspector-icon">
          <Icon name="scroll-text" />
        </span>
        <div className="inspector-title">
          <strong>Decisions</strong>
          <span>
            {decisions.list.length} in {decisions.inFolder ? `${decisions.dir}/` : 'this browser'}
            {here.size ? `, ${here.size} on this drawing` : ''}
          </span>
        </div>
        <button className="icon-button" onClick={() => p.onNew()} aria-label="New decision" title={`New decision${sel.length ? ' about the selection' : ''} (⌥⇧D)`}>
          <Icon name="file-plus" />
        </button>
        <button className="icon-button" onClick={p.onClose} aria-label="Close decisions" title="Close (⇧D)">
          <Icon name="x" />
        </button>
      </header>
      {p.draft ? (
        <NewDecision {...p} draft={p.draft} />
      ) : opened ? (
        <Opened {...p} d={opened} />
      ) : (
        <>
          <div className="notes-tools">
            <div className="segmented" role="radiogroup" aria-label="Show">
              {FILTERS.map(([f, label]) => (
                <button key={f} role="radio" aria-checked={p.filter === f} className={p.filter === f ? 'active' : ''} onClick={() => p.onFilter(f)}>
                  {label}
                </button>
              ))}
            </div>
            {selName && (
              <button className={p.onlySelection ? 'chip active' : 'chip'} aria-pressed={p.onlySelection} onClick={() => p.onOnlySelection(!p.onlySelection)} title="Only the decisions about what is selected">
                <Icon name="map-pin" size={13} /> About {selName}
              </button>
            )}
          </div>
          <div className="notes-body">
            {!shown.length && (
              <p className="notes-empty">
                {decisions.list.length
                  ? 'Nothing here with this filter.'
                  : `No decisions yet. Select what a decision is about and press ⌥⇧D, or use the + above. ${decisions.inFolder ? `They are written to ${decisions.dir}/.` : 'Open a folder to keep them next to the diagrams; until then they stay in this browser.'}`}
              </p>
            )}
            {shown.map((d) => (
              <button key={d.number} className={`decision-row${here.has(d.number) ? ' here' : ''}`} data-decision-row={d.number} onClick={() => p.onActive(d.number)}>
                <DecisionMark n={d.number} status={d.status} />
                <span className="decision-row-text">
                  <strong>{d.title}</strong>
                  <span>
                    {statusSaid(d)}
                    {d.date ? ` · ${d.date}` : ''}
                    {d.concerns.length ? ` · ${d.concerns.length} concern${d.concerns.length === 1 ? '' : 's'}` : ''}
                    {here.has(d.number) ? ' · on this drawing' : ''}
                  </span>
                  {decisionSummary(d, 120) && <span className="decision-row-summary">{decisionSummary(d, 120)}</span>}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      <footer className="notes-footer">
        <label>
          <input type="checkbox" checked={p.withExports} onChange={(e) => p.onWithExports(e.target.checked)} /> Exports include decisions
        </label>
      </footer>
    </aside>
  );
}

function NewDecision(p: PanelProps & { draft: { concerns: string[]; supersedes?: number } }) {
  const [title, setTitle] = useState('');
  const old = p.draft.supersedes ? p.decisions.get(p.draft.supersedes) : undefined;
  const [busy, setBusy] = useState(false);
  const make = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    const n = await p.decisions.create(title.trim(), p.draft.concerns, p.draft.supersedes);
    p.onDraft(undefined);
    p.onActive(n);
    setBusy(false);
  };
  return (
    <div className="notes-body decision-new">
      <p className="decision-new-head">
        <DecisionMark n={Math.max(0, ...p.decisions.list.map((d) => d.number)) + 1} status="proposed" /> {old ? `Supersedes ${old.number}. ${old.title}` : 'New decision, proposed'}
      </p>
      <label htmlFor="decision-title">Title: what was decided</label>
      <input
        id="decision-title"
        autoFocus
        value={title}
        placeholder="e.g. Use PostgreSQL for the customer store"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') void make();
          else if (e.key === 'Escape') p.onDraft(undefined);
        }}
      />
      <span className="decision-label">About</span>
      <Concerns {...p} concerns={p.draft.concerns} onRemove={(c) => p.onDraft({ ...p.draft, concerns: p.draft.concerns.filter((x) => x !== c) })} />
      {!p.draft.concerns.length && <p className="notes-empty">Nothing selected: it can be linked to elements later.</p>}
      <div className="note-actions">
        <button className="button primary small" disabled={!title.trim() || busy} onClick={() => void make()}>
          Create <kbd>↵</kbd>
        </button>
        <button className="button ghost small" onClick={() => p.onDraft(undefined)}>
          Cancel
        </button>
      </div>
      <p className="notes-empty">
        Written as {p.decisions.inFolder ? `${p.decisions.dir}/` : 'a file kept in this browser, '}NNNN-title.md from the template (context, options, decision, consequences){old ? `; ${old.number} is marked superseded` : ''}.
      </p>
    </div>
  );
}

function Concerns(p: PanelProps & { concerns: string[]; onRemove?(c: string): void }) {
  const graph = p.host.drawn?.graph;
  return (
    <div className="decision-concerns">
      {p.concerns.map((c) => {
        const t = graph ? resolveConcern(c, graph, p.at) : undefined;
        const name = t && graph ? targetName(t, graph) : (readConcern(c)?.kind === 'edge' ? c.replace(/\s*->\s*/, ' → ') : c);
        return (
          <span key={c} className={`chip decision-concern${t ? '' : ' elsewhere'}`}>
            <button onClick={() => p.onGo(c)} disabled={!t || t.kind === 'view'} title={t ? `Select ${name} (${c})` : `${c}: not in this drawing`}>
              {name}
            </button>
            {p.onRemove && (
              <button className="decision-unlink" onClick={() => p.onRemove!(c)} aria-label={`Unlink ${name}`} title="Unlink">
                <Icon name="x" size={12} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Opened(p: PanelProps & { d: Decision }) {
  const { d, decisions } = p;
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [text, setText] = useState(d.text);
  // Another decision, or this one changed on disk: the editor starts from what is written.
  useEffect(() => {
    setText(d.text);
  }, [d.file, d.text]);
  useEffect(() => setMode('read'), [d.file]);
  const dirty = text !== d.text;
  const save = async () => {
    await decisions.save(d.file, text);
    setMode('read');
  };
  const sel = p.selectionConcerns.filter((c) => !d.concerns.includes(c));
  const by = d.supersededBy ? decisions.get(d.supersededBy) : undefined;
  const blocks = useMemo(() => markdownBlocks((mode === 'edit' ? text : d.text).replace(/^---[\s\S]*?\n---[ \t]*\n/, '').replace(/^\s*#[ \t]+.*\n/, '')), [mode, text, d.text]);
  return (
    <div className="notes-body decision-open" data-decision-open={d.number}>
      <button className="note-go decision-back" onClick={() => p.onActive(undefined)}>
        <Icon name="arrow-left" size={13} /> All decisions
      </button>
      <h3 className="decision-title">
        <DecisionMark n={d.number} status={d.status} /> {d.title}
      </h3>
      <div className="decision-status">
        <label>
          <span className="sr-only">Status</span>
          <select value={d.status} aria-label="Status" onChange={(e) => void decisions.setStatus(d.number, e.target.value as DecisionStatus)}>
            {decisionStatuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </select>
        </label>
        {d.date && <span>{d.date}</span>}
        {by && (
          <button className="note-go" onClick={() => p.onActive(by.number)}>
            superseded by {by.number}
          </button>
        )}
        {d.supersedes.map((n) => (
          <button key={n} className="note-go" onClick={() => p.onActive(n)}>
            supersedes {n}
          </button>
        ))}
      </div>
      <span className="decision-label">About</span>
      <Concerns {...p} concerns={d.concerns} onRemove={(c) => void decisions.unlink(d.number, c)} />
      <div className="note-actions">
        {sel.length > 0 && (
          <button className="button ghost small" onClick={() => void Promise.all(sel.map((c) => decisions.link(d.number, c)))} title={`Link ${sel.join(', ')}`}>
            <Icon name="link" size={14} /> Link the selection
          </button>
        )}
        {decisionStands(d) && (
          <button className="button ghost small" onClick={() => p.onNew(d.number)} title="A new decision that replaces this one; this one is marked superseded">
            <Icon name="git-branch" size={14} /> Supersede…
          </button>
        )}
        {!decisions.inFolder && (
          <button className="button ghost small" onClick={() => decisions.download(d.number)}>
            <Icon name="download" size={14} /> Download
          </button>
        )}
      </div>
      <div className="segmented decision-mode" role="radiogroup" aria-label="Read or edit">
        <button role="radio" aria-checked={mode === 'read'} className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')}>
          Preview
        </button>
        <button
          role="radio"
          aria-checked={mode === 'edit'}
          className={mode === 'edit' ? 'active' : ''}
          onClick={() => setMode('edit')}
        >
          Markdown
        </button>
      </div>
      {mode === 'edit' ? (
        <>
          <textarea
            autoFocus
            className="decision-source"
            aria-label={`Markdown of decision ${d.number}`}
            value={text}
            spellCheck
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter')) {
                e.preventDefault();
                void save();
              } else if (e.key === 'Escape') {
                setText(d.text);
                setMode('read');
              }
            }}
          />
          <div className="note-actions">
            <button className="button primary small" disabled={!dirty} onClick={() => void save()}>
              Save <kbd>⌘S</kbd>
            </button>
            <button className="button ghost small" onClick={() => (setText(d.text), setMode('read'))}>
              Cancel
            </button>
            <span className="decision-file">{d.file}</span>
          </div>
          <DecisionText blocks={blocks} />
        </>
      ) : (
        <DecisionText blocks={blocks} />
      )}
    </div>
  );
}
