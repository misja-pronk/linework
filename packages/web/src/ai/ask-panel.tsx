// The Your AI panel (⌘J): changes from the user's own AI agent, which reaches the editor through
// Linework's MCP server and linework serve (live/use-live.ts). A proposal shows as a marked-up drawing
// and the YAML diff, and is accepted (⏎, one undo step) or rejected (Esc); the agent hears which. A
// file changed on disk shows the same way, already applied, with ⌘Z to take it back. Linework
// itself talks to no AI and to no network.
import { useEffect, useMemo, useRef, useState } from 'react';
import { applyOperations, yamlDiff, type DiagramType, type LayoutSidecar } from '@linework/core';
import { compare, summary as diffSummary, type Comparison } from '@linework/diff';
import { Icon } from '../icon.tsx';
import { t as tr } from '../i18n/index.ts';
import type { Live } from '../live/use-live.ts';
import './ask-panel.css';

/** A file that changed on disk while it was open, already in the editor. */
export interface DiskChange {
  path: string;
  before: string;
  after: string;
}

export interface AskPanelProps {
  text: string;
  type: DiagramType | undefined;
  sidecar?: LayoutSidecar;
  load?: (file: string) => string;
  theme: 'light' | 'dark';
  live: Live;
  change?: DiskChange;
  onAccept(yaml: string, renames: Map<string, string>): void;
  onUndoChange(): void;
  onDismissChange(): void;
  onCopyForAi(): void;
  onClose(): void;
  /** Behind another tab of the side panel. */
  hidden?: boolean;
}

type Past = { summary: string; state: 'accepted' | 'rejected' };

export function AskPanel(p: AskPanelProps) {
  const [past, setPast] = useState<Past[]>([]);
  const panel = useRef<HTMLElement>(null);
  const proposal = p.live.proposal;

  /** The proposal on the text as it is now: edits by path still apply after a hand edit elsewhere. */
  const current = useMemo(() => {
    if (!proposal) return undefined;
    if (p.text === proposal.base) return { yaml: proposal.yaml, renames: proposal.renames, stale: false };
    const r = p.type ? applyOperations(p.text, p.type, proposal.edits) : { error: '' };
    return 'error' in r ? { yaml: proposal.yaml, renames: proposal.renames, stale: true } : { yaml: r.text, renames: r.renames, stale: false };
  }, [proposal, p.text, p.type]);

  useEffect(() => {
    if (proposal) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('.proposal')?.focus());
  }, [proposal]);

  const said = (state: Past['state']) => setPast((x) => [...x.slice(-4), { summary: proposal?.summary || tr('A change'), state }]);
  const accept = () => {
    if (!proposal || !current || current.stale) return;
    p.onAccept(current.yaml, current.renames);
    said('accepted');
    p.live.settle({ outcome: 'accepted', ...(p.text !== proposal.base ? { message: 'Applied on top of edits the user made meanwhile.' } : {}) });
  };
  const reject = () => {
    if (!proposal) return;
    said('rejected');
    p.live.settle({ outcome: 'rejected' });
  };

  // ⏎ accepts and Esc rejects an open proposal from anywhere but a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (p.hidden || !proposal) return;
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, .cm-content');
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
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

  return (
    <aside className="ask-panel" ref={panel} aria-label={tr('Your AI')} hidden={p.hidden} onKeyDown={(e) => e.key === 'Escape' && !proposal && (e.stopPropagation(), p.onClose())}>
      <header>
        <Icon name="sparkles" size={16} />
        <strong>{tr('Your AI')}</strong>
        <span className="ask-scope">{p.live.served ? (p.live.connected ? tr('connected to linework serve') : tr('linework serve is not answering')) : tr('not connected')}</span>
        <button className="icon-button" onClick={p.onClose} title={tr('Close (⌘J)')} aria-label={tr('Close')}>
          <Icon name="x" />
        </button>
      </header>
      <div className="ask-log" aria-live="polite">
        {p.change && !proposal && (
          <div className="turn claude proposal-turn">
            <p className="proposal-summary">
              <Icon name="refresh-cw" size={14} /> {tr('{path} changed on disk', { path: p.change.path })}
            </p>
            <ProposalView before={p.change.before} after={p.change.after} sidecar={p.sidecar} load={p.load} theme={p.theme} applied onAccept={p.onDismissChange} onReject={p.onUndoChange} />
          </div>
        )}
        {proposal && current && (
          <div className="turn claude proposal-turn open">
            <p className="proposal-summary">
              <Icon name="git-pull-request" size={14} /> {proposal.summary || tr('A change')}
            </p>
            <ProposalView before={p.text} after={current.yaml} stale={current.stale} sidecar={p.sidecar} load={p.load} theme={p.theme} onAccept={accept} onReject={reject} />
          </div>
        )}
        {!proposal && !p.change && (
          <div className="ask-empty">
            <p>{tr('Ask your own AI (Claude Code, Copilot, Cursor, Codex…) for a change. Through Linework’s MCP server it sees what you have open and selected, and its changes show here as a diff to accept or reject.')}</p>
            {!p.live.served && <p className="fine">{tr('In the browser that needs linework serve: run linework serve in the folder and open the address it prints. In VS Code the extension does it.')}</p>}
            <p className="fine">{tr('Only a chat window? Copy the diagram with its schema and instructions, and paste the answer back as YAML.')}</p>
            <button type="button" className="button ghost" onClick={p.onCopyForAi}>
              <Icon name="copy" /> {tr('Copy for your AI')}
            </button>
          </div>
        )}
        {past.map((x, i) => (
          <div key={i} className={`turn claude proposal-turn ${x.state}`}>
            <p className="proposal-summary">
              <Icon name={x.state === 'accepted' ? 'check' : 'x'} size={14} /> {x.summary}
              <em> · {x.state === 'accepted' ? tr('accepted') : tr('rejected')}</em>
            </p>
          </div>
        ))}
      </div>
      <footer className="ask-sent">
        <span>{tr('Linework talks to no AI and no network itself: your agent works on the files, and linework serve only listens on this computer.')}</span>
      </footer>
    </aside>
  );
}

const stop = (e: KeyboardEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/**
 * The change as a marked-up drawing (added, changed, removed) and as a YAML diff, with the verdict
 * buttons; `applied`: a change already made (from disk), kept or undone.
 */
function ProposalView(p: { before: string; after: string; stale?: boolean; applied?: boolean; sidecar?: LayoutSidecar; load?: (f: string) => string; theme: 'light' | 'dark'; onAccept(): void; onReject(): void }) {
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
  const lines = useMemo(() => yamlDiff(p.before, p.after), [p.before, p.after]);
  return (
    <div className="proposal" tabIndex={-1} aria-label={p.applied ? tr('Change from disk') : tr('Proposed change')}>
      <div className="proposal-head">
        <div className="segmented" role="tablist">
          <button role="tab" className={tab === 'drawing' ? 'active' : undefined} aria-selected={tab === 'drawing'} onClick={() => setTab('drawing')}>
            {tr('Drawing')}
          </button>
          <button role="tab" className={tab === 'yaml' ? 'active' : undefined} aria-selected={tab === 'yaml'} onClick={() => setTab('yaml')}>
            YAML
          </button>
        </div>
        <span className="proposal-count">{cmp ? (cmp.c.diff.same ? tr('Nothing drawn differently') : diffSummary(cmp.c.diff)) : tr('Drawing the change…')}</span>
      </div>
      {tab === 'drawing' ? (
        <div className="proposal-drawing">{cmp?.svg ? <div className="proposal-svg" dangerouslySetInnerHTML={{ __html: cmp.svg }} /> : <span className="pulse" />}</div>
      ) : (
        <pre className="proposal-yaml" aria-label={tr('YAML diff')}>
          {lines.map((l, i) =>
            l.kind === 'fold' ? (
              <span key={i} className="fold">
                {tr('⋯ {count} unchanged line|⋯ {count} unchanged lines', { count: l.count })}
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
      {p.stale && <p className="callout error">{tr('The YAML changed since this was proposed, and the change no longer fits it. Reject it and ask your AI again.')}</p>}
      {p.applied ? (
        <div className="proposal-actions">
          <button className="button primary" onClick={p.onAccept}>
            <Icon name="check" /> {tr('Keep')}
          </button>
          <button className="button ghost" onClick={p.onReject}>
            <Icon name="undo-2" /> {tr('Undo')} <kbd>⌘Z</kbd>
          </button>
          <span className="fine">{tr('Already in the editor; ⌘Z takes all of it back.')}</span>
        </div>
      ) : (
        <div className="proposal-actions">
          <button className="button primary" onClick={p.onAccept} disabled={p.stale}>
            <Icon name="check" /> {tr('Accept')} <kbd>⏎</kbd>
          </button>
          <button className="button ghost" onClick={p.onReject}>
            <Icon name="x" /> {tr('Reject')} <kbd>Esc</kbd>
          </button>
          <span className="fine">{tr('Accept is one undo step. Pins stay.')}</span>
        </div>
      )}
    </div>
  );
}
