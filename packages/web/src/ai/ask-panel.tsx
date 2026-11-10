// The Ask panel (⌘J): questions to Claude about the open diagram. Answers come as text with clickable
// element references; changes come as a proposal (a marked-up drawing and the YAML diff) that is
// accepted (⏎, one undo step) or rejected (Esc). Only what is listed under "What is sent" goes to
// api.anthropic.com, with the user's own key, and only when they press Ask.
import { useEffect, useMemo, useRef, useState } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import type { Diagnostic, DiagramType, Graph, LayoutSidecar, Placed } from '@cartography/core';
import { compare, summary as diffSummary, type Comparison } from '@cartography/diff';
import { Icon } from '../icon.tsx';
import { store } from '../store.ts';
import { failure, MODELS, type ModelId } from './claude.ts';
import { ask, newConversation, type AskProgress, type Conversation, type Proposal } from './ask.ts';
import { contextMessage, followUpMessage, isReview, layoutReport, type AskContext } from './ask-prompt.ts';
import { Answer, type Ref } from './answer.tsx';
import { lineDiff } from './line-diff.ts';
import { applyOperations } from './edit-tools.ts';
import './ask-panel.css';

type Turn =
  | { who: 'you'; text: string }
  | { who: 'claude'; kind: 'answer'; text: string }
  | { who: 'claude'; kind: 'proposal'; summary: string; note: string; state: 'open' | 'accepted' | 'rejected' | 'replaced' }
  | { who: 'claude'; kind: 'refused'; text: string; errors: string[] }
  | { who: 'claude'; kind: 'failed'; message: string };

const QUICK = [
  { label: 'Explain this diagram', ask: 'Explain this diagram: what it shows and how the parts work together.' },
  { label: 'Threats', ask: 'Review this diagram for security threats: trust boundaries, exposed entry points, data flows without protection.' },
  { label: 'Single points of failure', ask: 'Review this diagram for single points of failure and what to do about each.' },
  { label: 'Missing monitoring', ask: 'Review this diagram for missing monitoring, logging and alerting.' },
];

/** The key only for this tab when it is not remembered: gone on reload, never in storage. */
let sessionKey = '';

export interface AskPanelProps {
  text: string;
  type: DiagramType | undefined;
  file?: string;
  graph?: Graph;
  placed?: Placed;
  selection: { kind: 'node' | 'group' | 'edge'; id: string }[];
  diagnostics: Diagnostic[];
  sidecar?: LayoutSidecar;
  load?: (file: string) => string;
  theme: 'light' | 'dark';
  /** Another document: the conversation starts over. */
  docKey: number;
  /** A question to put in the box (from the palette). */
  seed?: { text: string; n: number };
  onAccept(yaml: string, renames: Map<string, string>): void;
  onRef(r: Ref): void;
  onClose(): void;
  /** Behind another tab of the side panel: kept, conversation and all, but out of sight and keys. */
  hidden?: boolean;
}

export function AskPanel(p: AskPanelProps) {
  const [key, setKey] = useState(() => store.get<string>('claude-key') ?? sessionKey);
  const [remember, setRemember] = useState(() => !!store.get<string>('claude-key'));
  const [model, setModel] = useState<ModelId>(() => store.get<ModelId>('claude-model') ?? 'claude-opus-5-5');
  const [askingKey, setAskingKey] = useState(() => !(store.get<string>('claude-key') ?? sessionKey));
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [progress, setProgress] = useState<AskProgress>();
  const [proposal, setProposal] = useState<Proposal & { base: string }>();
  const [showSent, setShowSent] = useState(false);
  const conv = useRef<Conversation>(newConversation());
  const abort = useRef<AbortController>(undefined);
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const busy = !!progress;
  const hasKey = !!key.trim();

  // Another document starts a new conversation; whatever runs stops.
  useEffect(() => {
    abort.current?.abort();
    conv.current = newConversation();
    setTurns([]);
    setProposal(undefined);
    setProgress(undefined);
  }, [p.docKey]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => void (!p.hidden && box.current?.focus()), [p.hidden]);
  useEffect(() => {
    if (!p.seed) return;
    setQuestion(p.seed.text);
    box.current?.focus();
  }, [p.seed]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns, progress?.text, proposal]);

  const ctx = (q: string): AskContext | undefined =>
    p.type && {
      text: p.text,
      type: p.type,
      file: p.file,
      selection: p.selection.map((s) => ({ ...s, label: labelIn(p.graph, s) })),
      problems: p.diagnostics.filter((d) => d.severity === 'error').map((d) => (d.line ? `line ${d.line}: ${d.message}` : d.message)),
      ...(isReview(q) ? { layout: layoutReport(p.graph, p.placed) } : {}),
    };
  const messageFor = (q: string) => {
    const c = ctx(q);
    if (!c) return '';
    return conv.current.messages.length ? followUpMessage(c, q, conv.current.sent !== p.text) : contextMessage(c, q);
  };
  const preview = useMemo(() => (question.trim() ? messageFor(question) : messageFor('(your question)')), [question, p.text, p.selection, p.diagnostics, p.type, showSent]);

  const send = async (q = question) => {
    if (!q.trim() || busy || !p.type) return;
    if (!hasKey) {
      setAskingKey(true);
      return;
    }
    store.set('claude-key', remember ? key.trim() : null);
    sessionKey = key.trim();
    store.set('claude-model', model);
    setAskingKey(false);
    const content = messageFor(q);
    // An open proposal that gets a follow-up is replaced by the answer to it.
    if (proposal) setTurns((t) => t.map((x) => (x.who === 'claude' && x.kind === 'proposal' && x.state === 'open' ? { ...x, state: 'replaced' } : x)));
    setProposal(undefined);
    setTurns((t) => [...t, { who: 'you', text: q.trim() }]);
    setQuestion('');
    abort.current = new AbortController();
    setProgress({ text: '', attempt: 1 });
    const base = p.text;
    try {
      const out = await ask(conv.current, content, { apiKey: key.trim(), model, signal: abort.current.signal, base, type: p.type, load: p.load, onProgress: setProgress });
      if (out.kind === 'answer') setTurns((t) => [...t, { who: 'claude', kind: 'answer', text: out.text }]);
      else if (out.kind === 'refused') setTurns((t) => [...t, { who: 'claude', kind: 'refused', text: out.text, errors: out.errors }]);
      else {
        setTurns((t) => [...t, { who: 'claude', kind: 'proposal', summary: out.proposal.summary, note: out.proposal.note, state: 'open' }]);
        setProposal({ ...out.proposal, base });
        requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('.proposal')?.focus());
      }
    } catch (e) {
      if (abort.current?.signal.aborted) setTurns((t) => [...t, { who: 'claude', kind: 'failed', message: 'Stopped. Nothing was changed.' }]);
      else {
        setTurns((t) => [...t, { who: 'claude', kind: 'failed', message: failure(e) }]);
        if (e instanceof Anthropic.AuthenticationError) setAskingKey(true);
      }
    } finally {
      setProgress(undefined);
    }
  };
  const cancel = () => abort.current?.abort();

  const settleOpen = (state: 'accepted' | 'rejected') => setTurns((t) => t.map((x) => (x.who === 'claude' && x.kind === 'proposal' && x.state === 'open' ? { ...x, state } : x)));
  /** The proposal on the text as it is now: edits by path still apply after a hand edit elsewhere. */
  const current = useMemo(() => {
    if (!proposal) return undefined;
    if (p.text === proposal.base) return { yaml: proposal.yaml, stale: false };
    if (proposal.call.name === 'edit_diagram' && p.type) {
      const r = applyOperations(p.text, p.type, proposal.call.operations);
      if (!('error' in r)) return { yaml: r.text, stale: false };
    }
    return { yaml: proposal.yaml, stale: true };
  }, [proposal, p.text, p.type]);
  const accept = () => {
    if (!proposal || !current || current.stale) return;
    p.onAccept(current.yaml, proposal.renames);
    conv.current.verdict = 'The user accepted the change: it is applied to the diagram.';
    settleOpen('accepted');
    setProposal(undefined);
    box.current?.focus();
  };
  const reject = () => {
    if (!proposal) return;
    conv.current.verdict = 'The user rejected the change: the diagram is as it was.';
    settleOpen('rejected');
    setProposal(undefined);
    box.current?.focus();
  };

  // ⏎ accepts and Esc rejects an open proposal from anywhere but a text field; Esc also stops a run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (p.hidden) return;
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, .cm-content');
      if (e.key === 'Escape' && busy) {
        cancel();
        return stop(e);
      }
      if (!proposal || typing || e.metaKey || e.ctrlKey || e.altKey) return;
      // ⏎ on a focused button or link is that button's.
      if (e.key === 'Enter' && !e.shiftKey && !current?.stale && !(e.target as HTMLElement | null)?.closest?.('button, a, summary')) {
        accept();
        stop(e);
      } else if (e.key === 'Escape') {
        reject();
        stop(e);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const what = ctx(question);
  return (
    <aside className="ask-panel" ref={panel} aria-label="Ask Claude" hidden={p.hidden} onKeyDown={(e) => e.key === 'Escape' && !busy && !proposal && (e.stopPropagation(), p.onClose())}>
      <header>
        <Icon name="sparkles" size={16} />
        <strong>Ask Claude</strong>
        <span className="ask-scope">{p.selection.length ? `about ${p.selection.length === 1 ? (labelIn(p.graph, p.selection[0]!) ?? p.selection[0]!.id) : `${p.selection.length} selected`}` : 'about the whole diagram'}</span>
        <button className="icon-button" onClick={() => setAskingKey((v) => !v)} title="API key and model" aria-label="API key and model" aria-expanded={askingKey}>
          <Icon name="key-round" />
        </button>
        <button className="icon-button" onClick={p.onClose} title="Close (⌘J)" aria-label="Close">
          <Icon name="x" />
        </button>
      </header>
      {askingKey && (
        <div className="ask-key">
          <label className="ask-field">
            <span className="ask-label">Anthropic API key</span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} />
          </label>
          <div className="ask-key-row">
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember in this browser
            </label>
            <select value={model} onChange={(e) => setModel(e.target.value as ModelId)} aria-label="Model">
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          {!hasKey && (
            <p className="fine">
              Claude runs on your own key; its costs are yours.{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                Get a key ↗
              </a>
            </p>
          )}
        </div>
      )}
      <div className="ask-log" ref={log} aria-live="polite">
        {!turns.length && !busy && (
          <div className="ask-empty">
            <p>Ask for a change (“add a DR region in West Europe”, “split the API into three services”) or a question. Changes come back as a diff to accept or reject.</p>
            <div className="chips inline">
              {QUICK.map((q) => (
                <button key={q.label} type="button" className="chip" onClick={() => void send(q.ask)} disabled={!p.type}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.who === 'you' ? (
            <div key={i} className="turn you">
              {t.text}
            </div>
          ) : t.kind === 'answer' ? (
            <div key={i} className="turn claude">
              <Answer text={t.text} graph={p.graph} onRef={p.onRef} />
            </div>
          ) : t.kind === 'proposal' ? (
            <div key={i} className={`turn claude proposal-turn ${t.state}`}>
              {t.note && <Answer text={t.note} graph={p.graph} onRef={p.onRef} />}
              <p className="proposal-summary">
                <Icon name={t.state === 'accepted' ? 'check' : t.state === 'open' ? 'git-pull-request' : 'x'} size={14} /> {t.summary || 'A change'}
                {t.state !== 'open' && <em> · {t.state === 'accepted' ? 'accepted' : t.state === 'rejected' ? 'rejected' : 'replaced by the next answer'}</em>}
              </p>
            </div>
          ) : t.kind === 'refused' ? (
            <div key={i} className="turn claude">
              {t.text && <Answer text={t.text} graph={p.graph} onRef={p.onRef} />}
              <p className="callout error" role="alert">
                <Icon name="circle-exclamation-point" size={14} />
                <span>
                  Claude’s change did not validate after two fixes, so it is not offered. Nothing was changed. Try asking for a smaller step.
                  <details>
                    <summary>What was wrong</summary>
                    <small className="ask-errors">{t.errors.map((e) => (e.length > 240 ? `${e.slice(0, 240)}…` : e)).join('\n')}</small>
                  </details>
                </span>
              </p>
            </div>
          ) : (
            <div key={i} className="turn claude">
              <p className="callout error" role="alert">
                <Icon name="circle-exclamation-point" size={14} /> <span>{t.message}</span>
              </p>
            </div>
          ),
        )}
        {busy && (
          <div className="turn claude running">
            {progress.text && <Answer text={progress.text} graph={p.graph} onRef={p.onRef} />}
            <p className="ask-status">
              <span className="pulse" />{' '}
              {progress.attempt > 1 ? 'Fixing the change: it did not validate…' : progress.writing ? `Writing the change… ${progress.writing} characters` : progress.text ? 'Answering…' : 'Thinking…'}
              <button className="button ghost small" onClick={cancel}>
                Stop <kbd>Esc</kbd>
              </button>
            </p>
          </div>
        )}
        {proposal && current && (
          <ProposalView before={p.text} after={current.yaml} stale={current.stale} sidecar={p.sidecar} load={p.load} theme={p.theme} onAccept={accept} onReject={reject} />
        )}
      </div>
      <form
        className="ask-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={box}
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={proposal ? 'Ask for something different…' : p.selection.length ? 'Ask about the selection, or for a change to it…' : 'Ask about the diagram, or for a change…'}
          aria-label="Question for Claude"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            } else if (e.key === 'Escape' && proposal && !question) {
              e.preventDefault();
              e.stopPropagation();
              reject();
            }
          }}
          disabled={!p.type}
        />
        <button className="button primary" type="submit" disabled={busy || !question.trim() || !p.type} title={hasKey ? 'Ask (⏎)' : 'Enter an API key first'}>
          <Icon name="send" /> Ask
        </button>
      </form>
      <footer className="ask-sent">
        <span>
          Sent to api.anthropic.com when you ask: {what ? sentList(what) : 'the diagram'}. Nothing else; costs go to your key.
        </span>
        <button type="button" className="link" onClick={() => setShowSent((v) => !v)} aria-expanded={showSent}>
          {showSent ? 'Hide' : 'Show exactly'}
        </button>
        {showSent && <pre className="ask-sent-text">{preview}</pre>}
      </footer>
    </aside>
  );
}

const stop = (e: KeyboardEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

function sentList(c: AskContext): string {
  const parts = ['the YAML', `the ${c.type.name} schema and description`];
  if (c.selection.length) parts.push(`${c.selection.length} selected id${c.selection.length > 1 ? 's' : ''}`);
  parts.push(c.problems.length ? `${c.problems.length} problem${c.problems.length > 1 ? 's' : ''}` : 'the problem list');
  if (c.layout) parts.push('the layout report');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function labelIn(graph: Graph | undefined, s: { kind: string; id: string }): string | undefined {
  if (!graph) return undefined;
  if (s.kind === 'group') return graph.groups.find((g) => g.id === s.id)?.label;
  if (s.kind === 'edge') {
    const e = graph.edges.find((x) => x.id === s.id);
    return e ? `${e.from.node} -> ${e.to.node}` : undefined;
  }
  const shape = graph.nodes.find((n) => n.id === s.id)?.shape;
  return shape?.kind === 'card' ? shape.label : shape?.kind === 'table' ? shape.title : undefined;
}

/** The change as a marked-up drawing (added, changed, removed) and as a YAML diff, with the verdict buttons. */
function ProposalView(p: { before: string; after: string; stale: boolean; sidecar?: LayoutSidecar; load?: (f: string) => string; theme: 'light' | 'dark'; onAccept(): void; onReject(): void }) {
  const [tab, setTab] = useState<'drawing' | 'yaml'>('drawing');
  const [cmp, setCmp] = useState<{ c: Comparison; svg?: string }>();
  useEffect(() => {
    let stop = false;
    const opts = { theme: p.theme, sidecar: p.sidecar, load: p.load };
    void compare(p.before, p.after, { before: { ...opts, idPrefix: 'ask-was' }, after: { ...opts, idPrefix: 'ask-now' } })
      .then((c) => !stop && setCmp({ c, svg: c.picture({ against: 'now' })?.svg }))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [p.before, p.after, p.theme, p.sidecar, p.load]);
  const lines = useMemo(() => lineDiff(p.before, p.after), [p.before, p.after]);
  return (
    <div className="proposal" tabIndex={-1} aria-label="Proposed change">
      <div className="proposal-head">
        <div className="segmented" role="tablist">
          <button role="tab" className={tab === 'drawing' ? 'active' : undefined} aria-selected={tab === 'drawing'} onClick={() => setTab('drawing')}>
            Drawing
          </button>
          <button role="tab" className={tab === 'yaml' ? 'active' : undefined} aria-selected={tab === 'yaml'} onClick={() => setTab('yaml')}>
            YAML
          </button>
        </div>
        <span className="proposal-count">{cmp ? (cmp.c.diff.same ? 'Nothing drawn differently' : diffSummary(cmp.c.diff)) : 'Drawing the change…'}</span>
      </div>
      {tab === 'drawing' ? (
        <div className="proposal-drawing">{cmp?.svg ? <div className="proposal-svg" dangerouslySetInnerHTML={{ __html: cmp.svg }} /> : <span className="pulse" />}</div>
      ) : (
        <pre className="proposal-yaml" aria-label="YAML diff">
          {lines.map((l, i) =>
            l.kind === 'fold' ? (
              <span key={i} className="fold">
                ⋯ {l.count} unchanged line{l.count > 1 ? 's' : ''}
                {'\n'}
              </span>
            ) : (
              <span key={i} className={l.kind}>
                {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}
                {l.text}
                {'\n'}
              </span>
            ),
          )}
        </pre>
      )}
      {p.stale && <p className="callout error">The YAML changed since Claude made this, and the change no longer fits it. Ask again to get it for the new text.</p>}
      <div className="proposal-actions">
        <button className="button primary" onClick={p.onAccept} disabled={p.stale}>
          <Icon name="check" /> Accept <kbd>⏎</kbd>
        </button>
        <button className="button ghost" onClick={p.onReject}>
          <Icon name="x" /> Reject <kbd>Esc</kbd>
        </button>
        <span className="fine">Accept is one undo step. Pins stay.</span>
      </div>
    </div>
  );
}
