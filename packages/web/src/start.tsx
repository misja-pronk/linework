// Starting a diagram in three steps: pick a template, pick how to work (describe it to AI, build it
// visually, or write YAML), and for AI answer a few questions. The answers become a prompt that
// Claude runs here with your own key, or that you copy into any chat and paste the answer back.
import { useEffect, useMemo, useRef, useState } from 'react';
import { render, types } from '@cartography/engine';
import type { DiagramType } from '@cartography/core';
import { blankText, exampleLoader, starters, typeName, type Starter } from './library.ts';
import { Icon } from './icon.tsx';
import { useRestoreFocus } from './menu.tsx';
import { store } from './store.ts';
import { questionsFor, type Question } from './ai/questions.ts';
import { buildPrompt, extractYaml, promptText, type Answers } from './ai/prompt.ts';
import { failure, generate, MODELS, type ModelId } from './ai/claude.ts';
import { importMarkdown, importMermaid } from '@cartography/import';

export type View = 'visual' | 'code';

export interface Opened {
  text: string;
  name: string;
  /** The template it came from, for files next to bundled examples. */
  starter?: string;
  view: View;
  /** A new, empty diagram: nothing worth an "undo open". */
  blank?: boolean;
}

const thumbs = new Map<string, string>();
let thumbIds = 0;

/** A drawing of some YAML, kept while the next one is on its way. */
function useDrawing(text: string | undefined, theme: 'light' | 'dark', load?: (f: string) => string) {
  const [svg, setSvg] = useState<string>();
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (!text) return;
    let stop = false;
    const t = setTimeout(async () => {
      const r = await render(text, {
        theme,
        fonts: 'none',
        idPrefix: `s${thumbIds++}`,
        load,
      }).catch(() => undefined);
      if (stop || !r) return;
      if (r.svg) setSvg(r.svg);
      setErrors(r.diagnostics.filter((d) => d.severity === 'error').map((d) => (d.line ? `Line ${d.line}: ${d.message}` : d.message)));
    }, 250);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [text, theme, load]);
  return { svg, errors };
}

const MODES = [
  {
    view: 'ai',
    icon: 'sparkles',
    title: 'Describe it',
    text: 'Answer a few questions; Claude drafts the diagram for you to refine.',
    key: '1',
  },
  {
    view: 'visual',
    icon: 'mouse-pointer-2',
    title: 'Build visually',
    text: 'Drag shapes from the palette, connect them, edit in the panel. No YAML needed.',
    key: '2',
  },
  {
    view: 'code',
    icon: 'code',
    title: 'Write YAML',
    text: 'Start from this example with autocomplete and a live drawing next to it.',
    key: '3',
  },
] as const;

export function Start({ theme, initial, onOpen, onClose }: { theme: 'light' | 'dark'; initial?: Starter; onOpen(o: Opened): void; onClose(): void }) {
  const [starter, setStarter] = useState<Starter | undefined>(initial);
  const [step, setStep] = useState<'pick' | 'mode' | 'ask' | 'import'>(initial ? 'mode' : 'pick');
  useRestoreFocus();

  // Esc goes one step back, then closes.
  const back = () => (step === 'ask' ? setStep('mode') : step === 'mode' || step === 'import' ? setStep('pick') : onClose());
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      backRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const type = starter ? types.find((t) => t.id === starter.type) : undefined;
  const choose = (mode: (typeof MODES)[number]['view']) => {
    if (!starter) return;
    if (mode === 'ai') return setStep('ask');
    // Building visually from a full example is editing, not starting: the template is the start.
    onOpen({
      text: starter.text,
      name: starter.file,
      starter: starter.id,
      view: mode,
    });
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className={`templates start step-${step}`} role="dialog" aria-label="Start a diagram" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          {step !== 'pick' && (
            <button className="icon-button" onClick={back} aria-label="Back" title="Back (Esc)">
              <Icon name="arrow-left" />
            </button>
          )}
          <h2>
            {step === 'pick' ? 'Start a diagram' : step === 'import' ? 'Import from Mermaid' : step === 'mode' ? `${starter!.title}` : `Describe it · ${typeName(starter!.type)}`}
          </h2>
          {step !== 'import' && (
            <ol className="steps" aria-label="Steps">
              {['Template', 'How', ...(step === 'ask' ? ['Describe'] : [])].map((s, i) => (
                <li key={s} aria-current={i === ['pick', 'mode', 'ask'].indexOf(step)}>
                  {s}
                </li>
              ))}
            </ol>
          )}
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        {step === 'pick' && (
          <Pick
            theme={theme}
            onPick={(s) => {
              setStarter(s);
              setStep('mode');
            }}
            onImport={() => setStep('import')}
          />
        )}
        {step === 'import' && <Import theme={theme} onOpen={onOpen} />}
        {step === 'mode' && starter && (
          <Mode
            starter={starter}
            theme={theme}
            onChoose={choose}
            onBlank={() => onOpen({ text: blankText(starter.type), name: `${starter.type}.yaml`, view: 'visual', blank: true })}
          />
        )}
        {step === 'ask' && starter && type && <Ask starter={starter} type={type} theme={theme} onOpen={onOpen} />}
      </div>
    </div>
  );
}

function Pick({ theme, onPick, onImport }: { theme: 'light' | 'dark'; onPick(s: Starter): void; onImport(): void }) {
  const typeIds = useMemo(() => [...new Set(starters.map((s) => s.type))], []);
  const [filter, setFilter] = useState<string>('all');
  const [, redraw] = useState(0);
  const shown = starters.filter((s) => filter === 'all' || s.type === filter);
  /** Roving focus: one card is in the Tab order, arrows move between them. */
  const [active, setActive] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => setActive(0), [filter]);
  const onGridKey = (e: React.KeyboardEvent) => {
    const cards = [...(grid.current?.querySelectorAll<HTMLElement>('.template-card') ?? [])];
    const i = cards.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    // Columns from the layout: cards on the first row share its top.
    const cols = Math.max(1, cards.filter((c) => c.offsetTop === cards[0]!.offsetTop).length);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: cards.length - 1 - i }[e.key];
    if (step == null) return;
    e.preventDefault();
    const next = Math.min(cards.length - 1, Math.max(0, i + step));
    setActive(next);
    cards[next]!.focus();
  };

  // Thumbnails one by one, so the dialog opens at once and fills in.
  useEffect(() => {
    let stop = false;
    (async () => {
      for (const s of shown) {
        const key = `${theme}:${s.id}`;
        if (stop) return;
        if (thumbs.has(key)) continue;
        const r = await render(s.text, {
          theme,
          fonts: 'none',
          idPrefix: `t${thumbIds++}`,
          load: exampleLoader(s.id),
        });
        thumbs.set(key, r.svg ?? '');
        if (!stop) redraw((n) => n + 1);
      }
    })();
    return () => {
      stop = true;
    };
  }, [filter, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <nav className="chips">
        <div className="chip-row" role="group" aria-label="Diagram type">
          {['all', ...typeIds].map((t) => (
            <button key={t} className={filter === t ? 'chip active' : 'chip'} aria-pressed={filter === t} onClick={() => setFilter(t)}>
              {t === 'all' ? 'All' : typeName(t)}
            </button>
          ))}
        </div>
        <button className="chip import-chip" onClick={onImport} title="Paste a Mermaid diagram and get it back as Cartography">
          <Icon name="clipboard-paste" size={13} /> Import from Mermaid
        </button>
      </nav>
      <div className="template-grid" ref={grid} onKeyDown={onGridKey}>
        {shown.map((s, i) => {
          const svg = thumbs.get(`${theme}:${s.id}`);
          return (
            <button key={s.id} className="template-card" onClick={() => onPick(s)} autoFocus={i === 0} tabIndex={i === active ? 0 : -1} onFocus={() => setActive(i)}>
              <div className="thumb" aria-hidden="true">
                {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="thumb-wait" />}
              </div>
              <div className="template-meta">
                <span className="template-title">{s.title}</span>
                <span className="template-sub" title={s.kind === 'example' ? s.file : undefined}>
                  {s.kind === 'template' ? 'Template' : 'Example'} · {typeName(s.type)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Mode({ starter, theme, onChoose, onBlank }: { starter: Starter; theme: 'light' | 'dark'; onChoose(m: (typeof MODES)[number]['view']): void; onBlank(): void }) {
  const load = useMemo(() => exampleLoader(starter.id), [starter.id]);
  const { svg } = useDrawing(starter.text, theme, load);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const m = MODES.find((x) => x.key === e.key);
      if (m) onChoose(m.view);
      else if (e.key === 'b') onBlank();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose, onBlank]);
  return (
    <div className="mode-step">
      <div className="mode-preview">{svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="thumb-wait" />}</div>
      <div className="modes" role="group" aria-label="How do you want to work?">
        <p className="modes-intro">How do you want to work?</p>
        {MODES.map((m, i) => (
          <button key={m.view} className={`mode-card mode-${m.view}`} onClick={() => onChoose(m.view)} autoFocus={i === 0}>
            <span className="mode-icon">
              <Icon name={m.icon} size={20} />
            </span>
            <span className="mode-text">
              <strong>{m.title}</strong>
              <span>{m.text}</span>
            </span>
            <kbd>{m.key}</kbd>
          </button>
        ))}
        <button className="blank-start" onClick={onBlank}>
          <Icon name="file-plus" size={16} />
          <span>
            Or <strong>start blank</strong>: an empty {typeName(starter.type).toLowerCase()} in the builder
          </span>
          <kbd>B</kbd>
        </button>
      </div>
    </div>
  );
}

/** Chips shown per group before "More": enough to scan, not a wall. */
const FEW = 12;

function ChipGroup({ label, options, on, toggle }: { label: string; options: string[]; on: Set<string>; toggle(o: string): void }) {
  const [all, setAll] = useState(false);
  // Picked chips stay visible even when folded away.
  const shown = all ? options : options.filter((o, i) => i < FEW || on.has(o));
  return (
    <div className="chips inline" role="group" aria-label={label}>
      {shown.map((o) => (
        <button key={o} type="button" className={on.has(o) ? 'chip active' : 'chip'} aria-pressed={on.has(o)} onClick={() => toggle(o)}>
          {on.has(o) && <Icon name="check" size={12} />} {o}
        </button>
      ))}
      {options.length > shown.length && (
        <button type="button" className="chip more" onClick={() => setAll(true)}>
          {options.length - shown.length} more…
        </button>
      )}
    </div>
  );
}

function Field({ q, value, onChange }: { q: Question; value: string | string[] | undefined; onChange(v: string | string[]): void }) {
  if (q.kind === 'chips') {
    const on = new Set(Array.isArray(value) ? value : []);
    const toggle = (o: string) => {
      const next = new Set(on);
      if (!next.delete(o)) next.add(o);
      onChange([...next]);
    };
    const groups = q.groups && q.groups.length > 1 ? q.groups : [{ label: q.label, options: q.options! }];
    return (
      <div className="chip-groups">
        {groups.map((g) => (
          <div key={g.label}>
            {groups.length > 1 && <span className="chip-group-label">{g.label}</span>}
            <ChipGroup label={g.label} options={g.options} on={on} toggle={toggle} />
          </div>
        ))}
      </div>
    );
  }
  if (q.kind === 'choice')
    return (
      <div className="segmented" role="radiogroup" aria-label={q.label}>
        {q.options!.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? 'active' : ''} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    );
  const v = typeof value === 'string' ? value : '';
  return q.kind === 'long' ? (
    <textarea rows={2} value={v} placeholder={q.placeholder} onChange={(e) => onChange(e.target.value)} aria-label={q.label} />
  ) : (
    <input value={v} placeholder={q.placeholder} onChange={(e) => onChange(e.target.value)} aria-label={q.label} />
  );
}

type Phase =
  { at: 'form' } | { at: 'running'; text: string; attempt: number } | { at: 'paste' } | { at: 'done'; yaml: string; errors: string[] } | { at: 'failed'; message: string };

function Ask({ starter, type, theme, onOpen }: { starter: Starter; type: DiagramType; theme: 'light' | 'dark'; onOpen(o: Opened): void }) {
  const questions = useMemo(() => questionsFor(type), [type]);
  const [answers, setAnswers] = useState<Answers>(() => ({
    ...Object.fromEntries(questions.filter((q) => q.initial).map((q) => [q.id, q.initial!])),
    ...(store.get<Record<string, Answers>>('ai-answers')?.[type.id] ?? {}),
  }));
  const [key, setKey] = useState(() => store.get<string>('claude-key') ?? '');
  const [remember, setRemember] = useState(() => !!store.get<string>('claude-key'));
  const [model, setModel] = useState<ModelId>(() => store.get<ModelId>('claude-model') ?? 'claude-opus-5-5');
  const [phase, setPhase] = useState<Phase>({ at: 'form' });
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController>(undefined);
  useEffect(() => () => abort.current?.abort(), []);

  // The template's own YAML shows the model the style; an empty start teaches nothing, so use the type's template.
  const prompt = useMemo(() => buildPrompt(type, questions, answers, starter.text), [type, questions, answers, starter]);
  const load = useMemo(() => exampleLoader(starter.id), [starter.id]);
  const shown = phase.at === 'running' ? extractYaml(phase.text) : phase.at === 'done' ? phase.yaml : phase.at === 'paste' && pasted.trim() ? extractYaml(pasted) : undefined;
  const drawing = useDrawing(shown, theme, load);
  const stream = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (stream.current) stream.current.scrollTop = stream.current.scrollHeight;
  }, [shown]);

  const keep = () => {
    const all = store.get<Record<string, Answers>>('ai-answers') ?? {};
    store.set('ai-answers', { ...all, [type.id]: answers });
  };

  const run = async () => {
    keep();
    store.set('claude-key', remember ? key.trim() : null);
    store.set('claude-model', model);
    abort.current = new AbortController();
    setPhase({ at: 'running', text: '', attempt: 1 });
    try {
      const r = await generate(prompt, {
        apiKey: key.trim(),
        model,
        signal: abort.current.signal,
        load,
        onProgress: (p) => setPhase({ at: 'running', ...p }),
      });
      setPhase({ at: 'done', ...r });
    } catch (e) {
      if (abort.current?.signal.aborted) return setPhase({ at: 'form' });
      setPhase({ at: 'failed', message: failure(e) });
    }
  };

  const copy = async () => {
    keep();
    await navigator.clipboard.writeText(promptText(prompt)).catch(() => undefined);
    setCopied(true);
    setPhase({ at: 'paste' });
  };

  const open = (yaml: string, view: View) =>
    onOpen({
      text: yaml,
      name: `${type.id}.yaml`,
      starter: starter.kind === 'example' ? starter.id : undefined,
      view,
    });
  const busy = phase.at === 'running';
  const hasKey = !!key.trim();

  if (phase.at === 'form' || phase.at === 'failed')
    return (
      <div className="ask">
        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) void run();
          }}
        >
          {questions.map((q) => (
            <label key={q.id} className="ask-field">
              <span className="ask-label">{q.label}</span>
              <Field q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
              {q.help && <small>{q.help}</small>}
            </label>
          ))}
        </form>
        <aside className="ask-run">
          <h3>
            <Icon name="sparkles" size={16} /> Generate with Claude
          </h3>
          <label className="ask-field">
            <span className="ask-label">Anthropic API key</span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} />
          </label>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember in this browser
          </label>
          <label className="ask-field">
            <span className="ask-label">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value as ModelId)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {m.note}
                </option>
              ))}
            </select>
          </label>
          {!hasKey && (
            <p className="fine">
              No key?{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                Get a key ↗
              </a>{' '}
              or copy the prompt into any chat assistant below.
            </p>
          )}
          <button className={hasKey ? 'button primary wide' : 'button ghost wide'} onClick={() => void run()} disabled={!hasKey} title={hasKey ? undefined : 'Enter an API key first'}>
            <Icon name="sparkles" /> Generate <kbd>⌘↵</kbd>
          </button>
          <p className="fine">Your answers and key go only to api.anthropic.com, and only when you press Generate. Everything else stays in this browser.</p>
          {phase.at === 'failed' && (
            <p className="callout error" role="alert">
              <Icon name="circle-exclamation-point" size={14} /> <span>{phase.message}</span>
            </p>
          )}
          <div className="or">
            <span>or use any chat assistant</span>
          </div>
          <button className={hasKey ? 'button ghost wide' : 'button primary wide'} onClick={() => void copy()}>
            <Icon name="copy" /> Copy the prompt
          </button>
          {!hasKey && <p className="fine">Paste it into Claude or another assistant, then paste its answer back here.</p>}
          <KeyHint onRun={() => (hasKey ? void run() : document.querySelector<HTMLInputElement>('.ask-run input[type=password]')?.focus())} />
        </aside>
      </div>
    );

  return (
    <div className="ask result">
      <div className="ask-stream">
        <div className="ask-stream-head">
          {busy ? (
            <>
              <span className="pulse" /> {phase.attempt > 1 ? `Fixing ${phase.attempt - 1 === 1 ? 'a problem' : 'problems'}…` : 'Claude is drawing…'}
            </>
          ) : phase.at === 'paste' ? (
            <>
              <Icon name="clipboard-paste" size={14} /> {copied ? 'Prompt copied. ' : ''}Paste the answer here
            </>
          ) : phase.errors.length ? (
            <>
              <Icon name="triangle-exclamation-point" size={14} /> Almost: {phase.errors.length} problem{phase.errors.length > 1 ? 's' : ''} left to fix in the editor
            </>
          ) : (
            <>
              <Icon name="check" size={14} /> Ready
            </>
          )}
        </div>
        {phase.at === 'paste' ? (
          <textarea
            className="paste mono"
            autoFocus
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste the whole answer; the YAML is taken out of it."
            spellCheck={false}
          />
        ) : (
          <pre ref={stream} className="mono">
            {shown}
          </pre>
        )}
      </div>
      <div className="ask-preview">
        <div className="mode-preview">
          {drawing.svg ? (
            <div dangerouslySetInnerHTML={{ __html: drawing.svg }} />
          ) : !busy && shown && drawing.errors.length ? (
            <p className="fine">Nothing to draw until the problem below is fixed. Open it in YAML to fix it there.</p>
          ) : (
            <div className="thumb-wait" />
          )}
        </div>
        {!busy && shown && drawing.errors.length > 0 && <p className="fine">{drawing.errors[0]}</p>}
        <footer>
          {busy ? (
            <button className="button ghost" onClick={() => abort.current?.abort()}>
              <Icon name="circle-stop" /> Stop
            </button>
          ) : (
            <>
              <button className="button ghost" onClick={() => setPhase({ at: 'form' })}>
                <Icon name="arrow-left" /> Change answers
              </button>
              <span className="spacer" />
              <button className="button ghost" disabled={!shown} onClick={() => shown && open(shown, 'code')}>
                <Icon name="code" /> Open in YAML
              </button>
              <button className="button primary" disabled={!shown} onClick={() => shown && open(shown, 'visual')}>
                <Icon name="mouse-pointer-2" /> Open in builder
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/** ⌘↵ generates from anywhere in the form. */
function KeyHint({ onRun }: { onRun(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRun]);
  return null;
}

const MERMAID_SAMPLE = `flowchart LR
  user([Customer]) -->|HTTPS| web[Web shop]
  web --> api[Orders API]
  api --> db[(Orders DB)]
  api -.->|OrderPlaced| bus[[Event bus]]
  bus -.-> mail[Email worker]`;

/** Messages read as sentences: a capital first, a full stop last. */
const sentence = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/([^.!?…])$/, '$1.');

/** Paste Mermaid (or Markdown with mermaid blocks) and see it as Cartography right away. */
function Import({ theme, onOpen }: { theme: 'light' | 'dark'; onOpen(o: Opened): void }) {
  const [text, setText] = useState('');
  const [block, setBlock] = useState(0);
  const blocks = useMemo(() => {
    if (!text.trim()) return [];
    try {
      return /```mermaid/.test(text) ? importMarkdown(text) : [importMermaid(text)];
    } catch (e) {
      return [{ yaml: '', warnings: [e instanceof Error ? e.message : String(e)] }];
    }
  }, [text]);
  const current = blocks[Math.min(block, blocks.length - 1)];
  const drawing = useDrawing(current?.yaml || undefined, theme);
  const open = (view: View) => current?.yaml && onOpen({ text: current.yaml, name: 'imported.yaml', view });
  return (
    <div className="ask result">
      <div className="ask-stream">
        <div className="ask-stream-head">
          <Icon name="clipboard-paste" size={14} /> Paste a flowchart, architecture-beta or erDiagram
        </div>
        <textarea className="paste mono" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={MERMAID_SAMPLE} spellCheck={false} />
        {!text && (
          <button className="button ghost" style={{ margin: 12 }} onClick={() => setText(MERMAID_SAMPLE)}>
            Try the example
          </button>
        )}
      </div>
      <div className="ask-preview">
        {blocks.length > 1 && (
          <div className="segmented" role="radiogroup" aria-label="Mermaid block">
            {blocks.map((b, i) => (
              <button key={i} role="radio" aria-checked={i === block} className={i === block ? 'active' : ''} onClick={() => setBlock(i)}>
                Block {i + 1}
              </button>
            ))}
          </div>
        )}
        <div className="mode-preview">
          {drawing.svg && current?.yaml ? (
            <div dangerouslySetInnerHTML={{ __html: drawing.svg }} />
          ) : (
            <p className="fine">{text.trim() ? 'Nothing to draw: see the problem below.' : 'The Cartography version appears here as you paste.'}</p>
          )}
        </div>
        {current && current.warnings.length > 0 && (
          <div className={current.yaml ? 'callout warn' : 'callout error'} role={current.yaml ? 'status' : 'alert'}>
            <Icon name={current.yaml ? 'triangle-exclamation-point' : 'circle-exclamation-point'} size={14} />
            <div>
              <strong>
                {current.yaml
                  ? `${current.warnings.length === 1 ? 'One thing was' : `${current.warnings.length} things were`} left out or changed:`
                  : 'This could not be imported:'}
              </strong>
              <ul className="warnings">
                {current.warnings.slice(0, 4).map((w) => (
                  <li key={w}>{sentence(w)}</li>
                ))}
                {current.warnings.length > 4 && <li>…and {current.warnings.length - 4} more</li>}
              </ul>
            </div>
          </div>
        )}
        <footer>
          <span className="spacer" />
          <button className="button ghost" disabled={!current?.yaml} onClick={() => open('code')}>
            <Icon name="code" /> Open in YAML
          </button>
          <button className="button primary" disabled={!current?.yaml} onClick={() => open('visual')}>
            <Icon name="mouse-pointer-2" /> Open in builder
          </button>
        </footer>
      </div>
    </div>
  );
}
