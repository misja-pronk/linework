// The architecture review in the editor (packages/review): the Review tab of the side panel (findings
// by severity and pillar, each with why and how to fix it, set aside with a reason, turned into a
// decision) and the flags on the drawing while the tab is open. The rules run on the drawing as drawn,
// with the open folder's .cartography/rules.yaml or rules/*.yaml. Everything the editor (app.tsx)
// gives is in ReviewHost; what it gets back is in useReviewTool's result.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { reviewSpots, type RenderResult } from '@cartography/engine';
import { builtInIds, categories, categoryLabel, emptyConfig, ignoreFinding, readConfig, review, severityLabel, tally, type Category, type ConfigProblem, type Finding, type ReviewConfig, type Severity } from '@cartography/review';
import type { Command } from './palette.tsx';
import type { Workspace } from './files.ts';
import { Icon } from './icon.tsx';
import { keyHint } from './keys.ts';
import { store } from './store.ts';
import './review.css';

type Sel = { kind: 'node' | 'group' | 'edge'; id: string };

export interface ReviewHost {
  ws?: Workspace;
  /** The open document as drawn, and its YAML. */
  drawn?: RenderResult;
  text: string;
  textNow(): string;
  /** Reads files the diagram refers to (contracts). */
  load?: (file: string) => string;
  /** The type takes review: on its elements (a node-and-edge type). */
  inline: boolean;
  select(s: Sel): void;
  zoomToSelection(): void;
  focusDrawing(): void;
  notify(message: string, o?: { tone?: 'error' }): void;
  /** Puts new YAML in the editor (undoable). */
  apply(yaml: string): void;
  /** Opens a new decision, prefilled. */
  decide(title: string, about: Sel | undefined, context: string): void;
  open: boolean;
  setOpen(open: boolean): void;
}

/** The flag of a finding, as on paper: the severity's shape, then its number; an error's is filled. */
export function ReviewFlag({ severity, text }: { severity: Severity; text: string }) {
  const w = 4 + 10 + 4 + (text ? text.length * 6 + 6 : 0);
  const h = 17;
  const cx = 9;
  const cy = h / 2;
  const glyph =
    severity === 'error' ? (
      <path className="glyph" d={`M${cx - 2.1} ${cy - 5}H${cx + 2.1}L${cx + 5} ${cy - 2.1}V${cy + 2.1}L${cx + 2.1} ${cy + 5}H${cx - 2.1}L${cx - 5} ${cy + 2.1}V${cy - 2.1}Z`} />
    ) : severity === 'warn' ? (
      <path className="glyph" d={`M${cx} ${cy - 5.6}L${cx + 5.8} ${cy + 5}H${cx - 5.8}Z`} />
    ) : (
      <circle className="glyph" cx={cx} cy={cy} r={5} />
    );
  return (
    <svg className={`review-flag ${severity}`} width={w} height={h} viewBox={`-1 -1 ${w + 2} ${h + 2}`} aria-hidden="true">
      <path className="flag" d={`M0 0H${w}L${w - 4} ${h / 2}L${w} ${h}H0Z`} />
      {glyph}
      <text className="mark" x={cx} y={cy + (severity === 'warn' ? 4.6 : 3.2)} textAnchor="middle">
        {severity === 'info' ? 'i' : '!'}
      </text>
      {text && (
        <text className="ids" x={18} y={cy + 3.4}>
          {text}
        </text>
      )}
    </svg>
  );
}

/** The customer's settings in the open folder: .cartography/rules.yaml, then rules/*.yaml. */
function folderConfig(ws: Workspace | undefined): { config: ReviewConfig; problems: ConfigProblem[] } {
  const config = emptyConfig();
  const problems: ConfigProblem[] = [];
  if (!ws) return { config, problems };
  const files = [...ws.files.keys()].filter((p) => /^\.cartography\/rules\.ya?ml$/i.test(p)).concat([...ws.files.keys()].filter((p) => /^rules\/[^/]+\.ya?ml$/i.test(p) && !/^type:\s*\S/m.test(ws.files.get(p)!.text)).sort());
  for (const f of files) problems.push(...readConfig(ws.files.get(f)!.text, f, builtInIds, config).problems);
  return { config, problems };
}

type SeverityFilter = 'all' | Severity;
const SEVERITY_FILTERS: [SeverityFilter, string][] = [
  ['all', 'All'],
  ['error', 'Errors'],
  ['warn', 'Warnings'],
  ['info', 'Info'],
];

export function useReviewTool(h: ReviewHost) {
  const { open, setOpen } = h;
  const [active, setActive] = useState<string>();
  const [severity, setSeverity] = useState<SeverityFilter>(() => store.get<SeverityFilter>('review-severity') ?? 'all');
  const [pillar, setPillar] = useState<Category | undefined>();
  const settings = useMemo(() => folderConfig(h.ws), [h.ws, h.ws?.files]);
  const drawn = h.drawn;
  const result = useMemo(() => (drawn?.graph && drawn.type ? review(h.text, drawn, { config: settings.config, load: h.load }) : undefined), [drawn, h.text, settings]);
  const findings = result?.findings ?? [];
  const live = findings.filter((f) => !f.ignored);
  const counts = tally(findings);
  // The side panel's tab strip scrolls when narrow: the Review tab is brought into view.
  useEffect(() => {
    if (open) document.querySelector('.side-tabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open]);

  const toggle = () => {
    if (open) return close();
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    h.focusDrawing();
  };
  const go = (f: Finding) => {
    setActive(f.id || undefined);
    if (f.on.kind === 'diagram') return;
    h.select(f.on);
    requestAnimationFrame(() => h.zoomToSelection());
  };
  const ignore = (f: Finding, reason: string) => {
    const next = ignoreFinding(h.textNow(), f, reason, h.inline);
    if (next === h.textNow()) return h.notify('That finding could not be set aside here: write it under review: ignore: in the YAML', { tone: 'error' });
    h.apply(next);
    h.notify(`${f.id} set aside${reason.trim() ? '' : ' (no reason given: the report will say so)'}`);
  };
  const decide = (f: Finding) =>
    h.decide(`${f.rule.title}: ${f.about}`, f.on.kind === 'diagram' ? undefined : f.on, `The architecture review found: ${f.message} (${f.rule.id}). ${f.rule.why} Suggested: ${f.rule.fix}.`);
  /** Next finding, in the order of the list, for the keyboard. */
  const next = () => {
    if (!live.length) return h.notify('No findings');
    const i = live.findIndex((f) => f.id === active);
    const f = live[(i + 1) % live.length]!;
    setOpen(true);
    go(f);
  };

  const commands: Command[] = [
    { id: 'arch-review', group: 'Review', label: open ? 'Hide the architecture review' : 'Architecture review', hint: live.length ? `${live.length} finding${live.length === 1 ? '' : 's'}` : 'no findings', icon: 'shield-check', shortcut: keyHint('arch-review'), run: toggle },
    { id: 'arch-review-next', group: 'Review', label: 'Next review finding', hint: 'selects what it is about', icon: 'arrow-down', run: next },
  ];

  const markers = (scale: number): ReactNode => {
    const r = h.drawn;
    if (!open || !r?.graph || !r.placed || !live.length) return null;
    const o = r.origin ?? { x: 0, y: 0 };
    return reviewSpots(live, r.placed, { width: r.width ?? 0 }).map((s) => {
      const p = s.diagram ? s.at : { x: s.at.x + o.x, y: s.at.y + o.y };
      const ids = s.marks.length <= 2 ? s.marks.map((m) => m.id).join(' ') : `${s.marks[0]!.id} +${s.marks.length - 1}`;
      const worst = s.marks[0]!;
      return (
        <button
          key={s.marks.map((m) => m.id).join(' ')}
          className={`review-marker${s.marks.some((m) => m.id === active) ? ' active' : ''}`}
          data-review={s.marks.map((m) => m.id).join(' ')}
          style={{ left: p.x, top: p.y, transform: `scale(${1 / scale})` }}
          aria-label={s.marks.map((m) => `${m.id}, ${severityLabel[m.severity as Severity]}: ${m.message}`).join('; ')}
          title={s.marks.map((m) => `${m.id} ${severityLabel[m.severity as Severity]}: ${m.message}`).join('\n')}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setActive(worst.id);
            requestAnimationFrame(() => document.querySelector(`[data-finding="${worst.id}"]`)?.scrollIntoView({ block: 'nearest' }));
          }}
        >
          <ReviewFlag severity={worst.severity as Severity} text={ids} />
        </button>
      );
    });
  };

  const panel: ReactNode = open ? (
    <ReviewPanel
      findings={findings}
      ran={result?.rules.length ?? 0}
      off={!!result?.off}
      problems={[...settings.problems.map((p) => `${p.file}${p.line ? `:${p.line}` : ''}: ${p.message}`), ...(result?.problems ?? []).map((p) => `${p.line ? `line ${p.line}: ` : ''}${p.message}`)]}
      configFiles={settings.config.files}
      severity={severity}
      onSeverity={(s) => (setSeverity(s), store.set('review-severity', s))}
      pillar={pillar}
      onPillar={setPillar}
      active={active}
      onGo={go}
      onIgnore={ignore}
      onDecide={decide}
      onClose={close}
    />
  ) : null;

  return { open, toggle, close, next, commands, markers, panel, count: live.length, counts };
}

interface PanelProps {
  findings: Finding[];
  ran: number;
  off: boolean;
  problems: string[];
  configFiles: string[];
  severity: SeverityFilter;
  onSeverity(s: SeverityFilter): void;
  pillar?: Category;
  onPillar(c: Category | undefined): void;
  active?: string;
  onGo(f: Finding): void;
  onIgnore(f: Finding, reason: string): void;
  onDecide(f: Finding): void;
  onClose(): void;
}

function ReviewPanel(p: PanelProps) {
  const live = p.findings.filter((f) => !f.ignored);
  const aside = p.findings.filter((f) => f.ignored);
  const shown = live.filter((f) => (p.severity === 'all' || f.severity === p.severity) && (!p.pillar || f.rule.category === p.pillar));
  const pillars = categories.filter((c) => live.some((f) => f.rule.category === c));
  const [ignoring, setIgnoring] = useState<string>();
  const [reason, setReason] = useState('');
  const [showAside, setShowAside] = useState(false);
  const t = tally(p.findings);
  return (
    <aside className="inspector review-panel" aria-label="Architecture review">
      <header>
        <span className="inspector-icon">
          <Icon name="shield-check" />
        </span>
        <div className="inspector-title">
          <strong>Review</strong>
          <span>
            {p.off ? 'off for this file (review: off)' : live.length ? [t.error && `${t.error} error${t.error === 1 ? '' : 's'}`, t.warn && `${t.warn} warning${t.warn === 1 ? '' : 's'}`, t.info && `${t.info} info`].filter(Boolean).join(', ') : `no findings, ${p.ran} rules`}
          </span>
        </div>
        <button className="icon-button" onClick={p.onClose} aria-label="Close the review" title={`Close (${keyHint('arch-review')})`}>
          <Icon name="x" />
        </button>
      </header>
      <div className="notes-tools">
        <div className="segmented" role="radiogroup" aria-label="Severity">
          {SEVERITY_FILTERS.map(([s, label]) => (
            <button key={s} role="radio" aria-checked={p.severity === s} className={p.severity === s ? 'active' : ''} onClick={() => p.onSeverity(s)}>
              {label}
            </button>
          ))}
        </div>
        {pillars.length > 1 &&
          pillars.map((c) => (
            <button key={c} className={p.pillar === c ? 'chip active' : 'chip'} aria-pressed={p.pillar === c} onClick={() => p.onPillar(p.pillar === c ? undefined : c)}>
              {categoryLabel[c]}
            </button>
          ))}
      </div>
      <div className="notes-body">
        {p.problems.map((m, i) => (
          <p key={i} className="review-problem">
            <Icon name="circle-exclamation-point" size={13} /> {m}
          </p>
        ))}
        {!shown.length && <p className="notes-empty">{live.length ? 'Nothing here with this filter.' : `The ${p.ran} rules that apply to this diagram found nothing.${p.configFiles.length ? '' : ' Your own rules go in .cartography/rules.yaml in the folder (docs/review.md).'}`}</p>}
        {shown.map((f) => (
          <div key={f.id} className={`finding-row ${f.severity}${p.active === f.id ? ' active' : ''}`} data-finding={f.id}>
            <button className="finding-main" onClick={() => p.onGo(f)} title={f.on.kind === 'diagram' ? 'About the whole diagram' : `Select ${f.about}`}>
              <ReviewFlag severity={f.severity} text={f.id} />
              <span className="finding-text">
                <strong>{f.rule.title}</strong>
                <span className="finding-message">{f.message}</span>
                <span className="finding-meta">
                  {severityLabel[f.severity]} · {categoryLabel[f.rule.category]} · {f.rule.id}
                  {f.line ? ` · line ${f.line}` : ''}
                </span>
              </span>
            </button>
            {p.active === f.id && (
              <div className="finding-detail">
                <p>
                  <span className="finding-label">Why</span> {f.rule.why}
                </p>
                <p>
                  <span className="finding-label">Fix</span> {f.rule.fix}
                </p>
                {f.rule.docs && (
                  <p>
                    <span className="finding-label">Read</span> {f.rule.docs}
                  </p>
                )}
              </div>
            )}
            {ignoring === f.id ? (
              <div className="finding-ignore">
                <input
                  autoFocus
                  aria-label={`Why ${f.id} is set aside`}
                  placeholder="Why it does not apply, e.g. internal tool behind the VPN"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      p.onIgnore(f, reason);
                      setIgnoring(undefined);
                    } else if (e.key === 'Escape') setIgnoring(undefined);
                  }}
                />
                <button
                  className="button primary small"
                  onClick={() => {
                    p.onIgnore(f, reason);
                    setIgnoring(undefined);
                  }}
                >
                  Set aside <kbd>↵</kbd>
                </button>
              </div>
            ) : (
              <div className="finding-actions">
                <button className="button ghost small" onClick={() => (setIgnoring(f.id), setReason(''))} title="Set this finding aside, with a reason (written in the YAML)">
                  <Icon name="eye-off" size={13} /> Ignore…
                </button>
                <button className="button ghost small" onClick={() => p.onDecide(f)} title="A new architecture decision about it, prefilled">
                  <Icon name="scroll-text" size={13} /> Decision…
                </button>
              </div>
            )}
          </div>
        ))}
        {aside.length > 0 && (
          <div className="review-aside">
            <button className="note-go" aria-expanded={showAside} onClick={() => setShowAside(!showAside)}>
              <Icon name={showAside ? 'chevron-down' : 'chevron-right'} size={13} /> {aside.length} set aside
            </button>
            {showAside &&
              aside.map((f, i) => (
                <p key={i} className="review-aside-row">
                  <code>{f.rule.id}</code> on {f.about}: {f.ignored!.reason ?? <em>no reason given</em>}
                </p>
              ))}
          </div>
        )}
      </div>
      <footer className="notes-footer">
        <span className="review-foot">
          {p.ran} rules{p.configFiles.length ? ` · ${p.configFiles.join(', ')}` : ''} · <kbd>carto review</kbd> for a report
        </span>
      </footer>
    </aside>
  );
}
