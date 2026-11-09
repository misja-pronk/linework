// Starting a diagram in three steps: pick a template, pick how to work (describe it to AI, build it
// visually, or write YAML), and for AI answer a few questions. The answers become a prompt that
// Claude runs here with your own key, or that you copy into any chat and paste the answer back.
import { useEffect, useMemo, useRef, useState } from 'react';
import { render, types } from '@cartography/engine';
import type { DiagramType } from '@cartography/core';
import { exampleLoader, starters, typeName, type Starter } from './library.ts';
import { Icon } from './icon.tsx';
import { useRestoreFocus } from './menu.tsx';
import { store } from './store.ts';
import { questionsFor, type Question } from './ai/questions.ts';
import { buildPrompt, extractYaml, promptText, type Answers } from './ai/prompt.ts';
import { failure, generate, MODELS, type ModelId } from './ai/claude.ts';

export type View = 'visual' | 'code';

export interface Opened {
  text: string;
  name: string;
  /** The template it came from, for files next to bundled examples. */
  starter?: string;
  view: View;
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
      const r = await render(text, { theme, fonts: 'none', idPrefix: `s${thumbIds++}`, load }).catch(() => undefined);
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
  { view: 'ai', icon: 'sparkles', title: 'Describe it', text: 'Answer a few questions; Claude drafts the diagram for you to refine.', key: '1' },
  { view: 'visual', icon: 'mouse-pointer-2', title: 'Build visually', text: 'Drag shapes from the palette, connect them, edit in the panel. No YAML needed.', key: '2' },
  { view: 'code', icon: 'code', title: 'Write YAML', text: 'Start from this example with autocomplete and a live drawing next to it.', key: '3' },
] as const;

export function Start({ theme, initial, onOpen, onClose }: { theme: 'light' | 'dark'; initial?: Starter; onOpen(o: Opened): void; onClose(): void }) {
  const [starter, setStarter] = useState<Starter | undefined>(initial);
  const [step, setStep] = useState<'pick' | 'mode' | 'ask'>(initial ? 'mode' : 'pick');
  useRestoreFocus();

  // Esc goes one step back, then closes.
  const back = () => (step === 'ask' ? setStep('mode') : step === 'mode' ? setStep('pick') : onClose());
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
    onOpen({ text: starter.text, name: starter.file, starter: starter.id, view: mode });
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
          <h2>{step === 'pick' ? 'Start a diagram' : step === 'mode' ? `${starter!.title}` : `Describe it · ${typeName(starter!.type)}`}</h2>
          <ol className="steps" aria-label="Steps">
            {['Template', 'How', ...(step === 'ask' ? ['Describe'] : [])].map((s, i) => (
              <li key={s} aria-current={i === ['pick', 'mode', 'ask'].indexOf(step)}>
                {s}
              </li>
            ))}
          </ol>
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
          />
        )}
        {step === 'mode' && starter && <Mode starter={starter} theme={theme} onChoose={choose} />}
        {step === 'ask' && starter && type && <Ask starter={starter} type={type} theme={theme} onOpen={onOpen} />}
      </div>
    </div>
  );
}

function Pick({ theme, onPick }: { theme: 'light' | 'dark'; onPick(s: Starter): void }) {
  const typeIds = useMemo(() => [...new Set(starters.map((s) => s.type))], []);
  const [filter, setFilter] = useState<string>('all');
  const [, redraw] = useState(0);
  const shown = starters.filter((s) => filter === 'all' || s.type === filter);

  // Thumbnails one by one, so the dialog opens at once and fills in.
  useEffect(() => {
    let stop = false;
    (async () => {
      for (const s of shown) {
        const key = `${theme}:${s.id}`;
        if (stop) return;
        if (thumbs.has(key)) continue;
        const r = await render(s.text, { theme, fonts: 'none', idPrefix: `t${thumbIds++}`, load: exampleLoader(s.id) });
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
        {['all', ...typeIds].map((t) => (
          <button key={t} className={filter === t ? 'chip active' : 'chip'} onClick={() => setFilter(t)}>
            {t === 'all' ? 'All' : typeName(t)}
          </button>
        ))}
      </nav>
      <div className="template-grid">
        {shown.map((s) => {
          const svg = thumbs.get(`${theme}:${s.id}`);
          return (
            <button key={s.id} className="template-card" onClick={() => onPick(s)} autoFocus={s === shown[0]}>
              <div className="thumb">{svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="thumb-wait" />}</div>
              <div className="template-meta">
                <span className="template-title">{s.title}</span>
                <span className="template-sub">
                  {s.kind === 'template' ? 'Template' : s.kind === 'empty' ? 'Empty' : 'Example'} · {typeName(s.type)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Mode({ starter, theme, onChoose }: { starter: Starter; theme: 'light' | 'dark'; onChoose(m: (typeof MODES)[number]['view']): void }) {
  const load = useMemo(() => exampleLoader(starter.id), [starter.id]);
  const { svg } = useDrawing(starter.text, theme, load);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = MODES.find((x) => x.key === e.key);
      if (m && !(e.target instanceof HTMLInputElement)) onChoose(m.view);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose]);
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
      </div>
    </div>
  );
}

function Field({ q, value, onChange }: { q: Question; value: string | string[] | undefined; onChange(v: string | string[]): void }) {
  if (q.kind === 'chips') {
    const on = new Set(Array.isArray(value) ? value : []);
    return (
      <div className="chips inline" role="group" aria-label={q.label}>
        {q.options!.map((o) => (
          <button
            key={o}
            type="button"
            className={on.has(o) ? 'chip active' : 'chip'}
            aria-pressed={on.has(o)}
            onClick={() => {
              const next = new Set(on);
              if (!next.delete(o)) next.add(o);
              onChange([...next]);
            }}
          >
            {on.has(o) && <Icon name="check" size={12} />} {o}
          </button>
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

type Phase = { at: 'form' } | { at: 'running'; text: string; attempt: number } | { at: 'paste' } | { at: 'done'; yaml: string; errors: string[] } | { at: 'failed'; message: string };

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
  const prompt = useMemo(() => buildPrompt(type, questions, answers, starter.kind === 'empty' ? undefined : starter.text), [type, questions, answers, starter]);
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
      const r = await generate(prompt, { apiKey: key.trim(), model, signal: abort.current.signal, load, onProgress: (p) => setPhase({ at: 'running', ...p }) });
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

  const open = (yaml: string, view: View) => onOpen({ text: yaml, name: `${type.id}.yaml`, starter: starter.kind === 'example' ? starter.id : undefined, view });
  const busy = phase.at === 'running';

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
          <button className="button primary wide" onClick={() => void run()} disabled={!key.trim()}>
            <Icon name="sparkles" /> Generate <kbd>⌘↵</kbd>
          </button>
          <p className="fine">Your answers and key go only to api.anthropic.com, and only when you press Generate. Everything else stays in this browser.</p>
          {phase.at === 'failed' && (
            <p className="ask-error" role="alert">
              <Icon name="circle-exclamation-point" size={14} /> {phase.message}
            </p>
          )}
          <div className="or">
            <span>or use any chat assistant</span>
          </div>
          <button className="button ghost wide" onClick={() => void copy()}>
            <Icon name="copy" /> Copy the prompt
          </button>
          <KeyHint onRun={() => key.trim() && void run()} />
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
          <textarea className="paste mono" autoFocus value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the whole answer; the YAML is taken out of it." spellCheck={false} />
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
