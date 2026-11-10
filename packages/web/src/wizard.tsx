// The Wizard mode of the start dialog: one question at a time, the drawing redrawn as you answer.
// The questions and the YAML come from @cartography/wizards (the same engine `carto new --wizard` uses),
// so what you see here is what the terminal would write.
import { useEffect, useMemo, useRef, useState } from 'react';
import { render } from '@cartography/engine';
import { asked, resolve, type Answer, type Answers, type Question, type Wizard } from '@cartography/wizards';
import { Icon } from './icon.tsx';
import { store } from './store.ts';
import './wizard.css';

export interface WizardResult {
  yaml: string;
  name: string;
  view: 'visual' | 'code';
}

let ids = 0;

/** The drawing of the current answers; the last one stays while the next is drawn, so it never blinks. */
function useLiveDrawing(yaml: string, theme: 'light' | 'dark') {
  const [svg, setSvg] = useState<string>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    let stop = false;
    const t = setTimeout(async () => {
      const r = await render(yaml, { theme, fonts: 'none', idPrefix: `w${ids++}` }).catch((e: unknown) => ({ svg: undefined, diagnostics: [{ severity: 'error', message: String(e) }] }));
      if (stop) return;
      if (r.svg) setSvg(r.svg);
      setProblem(r.diagnostics.find((d) => d.severity === 'error')?.message);
    }, 60);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [yaml, theme]);
  return { svg, problem };
}

const saved = () => store.get<Record<string, Answers>>('wizard-answers') ?? {};

/** The wizard chooser as a question of its own, when a type has more than one. */
const PICK = '__wizard';

export function WizardSteps({ wizards, theme, onOpen, onAsk }: { wizards: Wizard[]; theme: 'light' | 'dark'; onOpen(r: WizardResult): void; onAsk(r: WizardResult): void }) {
  const [wizardId, setWizardId] = useState(wizards[0]!.id);
  const wizard = wizards.find((w) => w.id === wizardId) ?? wizards[0]!;
  const [answers, setAnswers] = useState<Answers>(() => saved()[wizard.id] ?? {});
  // Position in the list of questions asked (which depends on the answers); -1 is the chooser.
  const [at, setAt] = useState(wizards.length > 1 ? -1 : 0);
  const questions = useMemo(() => asked(wizard, answers), [wizard, answers]);
  const full = useMemo(() => resolve(wizard, answers), [wizard, answers]);
  const yaml = useMemo(() => wizard.build(full), [wizard, full]);
  const drawing = useLiveDrawing(yaml, theme);
  const q = at >= 0 ? questions[Math.min(at, questions.length - 1)] : undefined;
  const last = at >= questions.length - 1;

  const pick = (id: string) => {
    setWizardId(id);
    setAnswers(saved()[id] ?? {});
  };
  const set = (id: string, v: Answer) => setAnswers((a) => ({ ...a, [id]: v }));
  const keep = () => store.set('wizard-answers', { ...saved(), [wizard.id]: answers });
  const result = (view: WizardResult['view']): WizardResult => (keep(), { yaml, name: `${wizard.id}.yaml`, view });
  /** How the drawing opens when finished: as the person last worked (building visually, or the YAML). */
  const [how, setHowState] = useState<WizardResult['view']>(() => (store.get<string>('view') === 'code' ? 'code' : 'visual'));
  const setHow = (v: WizardResult['view']) => (setHowState(v), store.set('view', v));
  /** The preview at full size, to read it, or fitted to its box. */
  const [close, setClose] = useState(false);
  const next = () => (last ? onOpen(result(how)) : setAt((i) => i + 1));
  const back = () => setAt((i) => Math.max(wizards.length > 1 ? -1 : 0, i - 1));
  const canBack = at > (wizards.length > 1 ? -1 : 0);

  // Esc steps back through the questions before the dialog takes it back a step; ⌘↵ finishes from anywhere.
  const keys = useRef({ back, canBack, finish: () => onOpen(result(how)) });
  keys.current = { back, canBack, finish: () => onOpen(result(how)) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && keys.current.canBack) {
        e.preventDefault();
        keys.current.back();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        keys.current.finish();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const chooser: Question | undefined =
    at < 0 ? { id: PICK, kind: 'choice', label: 'Which one?', default: wizard.id, options: wizards.map((w) => ({ value: w.id, label: w.name, help: w.description })) } : undefined;
  const shown = chooser ?? q!;
  const value = chooser ? wizard.id : (full[shown.id] ?? (shown as Question).default);
  const total = questions.length;

  return (
    <div className="wizard">
      <div className="wizard-ask">
        <div className="wizard-progress" role="group" aria-label="Questions">
          {wizards.length > 1 && (
            <button className={at < 0 ? 'dot current' : 'dot done'} onClick={() => setAt(-1)} title="Which wizard" aria-label="Which wizard" aria-current={at < 0} />
          )}
          {questions.map((x, i) => (
            <button key={x.id} className={i === at ? 'dot current' : i < at ? 'dot done' : 'dot'} onClick={() => setAt(i)} title={x.label} aria-label={`Question ${i + 1}: ${x.label}`} aria-current={i === at} />
          ))}
          <span className="wizard-count">{at < 0 ? wizard.name : `${at + 1} of ${total}`}</span>
        </div>
        <div className="wizard-question" key={`${wizard.id}:${shown.id}`}>
          <h3 id="wizard-q">{shown.label}</h3>
          {shown.help && <p className="fine">{shown.help}</p>}
          <Field q={shown} value={value} onChange={(v) => (chooser ? pick(String(v)) : set(shown.id, v))} onEnter={next} />
        </div>
        <footer className="wizard-nav">
          <button className="button ghost" onClick={back} disabled={!canBack} title="Previous question (Esc)">
            <Icon name="arrow-left" /> Back
          </button>
          <span className="spacer" />
          {last ? (
            <button className="button primary" onClick={next} title={how === 'code' ? 'Open the drawing with its YAML' : 'Open the drawing to build on'}>
              Finish <kbd>↵</kbd>
            </button>
          ) : (
            <button className="button primary" onClick={next}>
              Next <kbd>↵</kbd>
            </button>
          )}
        </footer>
        {/* Every answer has a default: done now, without the questions left (a trackpad's ⌘↵), on a row of its own so Next keeps its room. */}
        {!last && (
          <button className="button ghost small wizard-early" onClick={() => keys.current.finish()} title="Use the defaults for the questions left and open the drawing (⌘↵)">
            Finish with defaults <kbd>⌘↵</kbd>
          </button>
        )}
        <p className="fine wizard-source" title={wizard.source}>
          After {wizard.source.split(/[,:(]/)[0]}.
        </p>
      </div>
      <div className="ask-preview wizard-preview">
        <div
          className={close ? 'mode-preview close' : 'mode-preview'}
          aria-live="polite"
          aria-label="Preview of the drawing"
          role="button"
          tabIndex={0}
          title={close ? 'Click to fit the drawing again' : 'Click to read it at full size'}
          onClick={() => setClose((c) => !c)}
          onKeyDown={(e) => (e.key === ' ' || (e.key === 'Enter' && !e.metaKey && !e.ctrlKey)) && (e.preventDefault(), setClose((c) => !c))}
        >
          {drawing.svg ? <div dangerouslySetInnerHTML={{ __html: drawing.svg }} /> : <div className="thumb-wait" />}
        </div>
        {drawing.problem && <p className="fine">{drawing.problem}</p>}
        <footer>
          <div className="segmented" role="radiogroup" aria-label="Open it">
            <button role="radio" aria-checked={how === 'visual'} className={how === 'visual' ? 'active' : ''} onClick={() => setHow('visual')}>
              <Icon name="mouse-pointer-2" /> Builder
            </button>
            <button role="radio" aria-checked={how === 'code'} className={how === 'code' ? 'active' : ''} onClick={() => setHow('code')}>
              <Icon name="code" /> YAML
            </button>
          </div>
          <span className="spacer" />
          <button className="button ghost" onClick={() => onAsk(result(how))} title="Describe what else it needs; Claude starts from this drawing">
            <Icon name="sparkles" /> Ask Claude to refine it
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Keys that pick an option: 1–9, and y/n for a yes/no. */
const digit = (e: React.KeyboardEvent) => (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey ? Number(e.key) - 1 : -1);

function Field({ q, value, onChange, onEnter }: { q: Question; value: Answer; onChange(v: Answer): void; onEnter(): void }) {
  const box = useRef<HTMLDivElement>(null);
  // Focus lands on the answer, so the keys work at once.
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('input, [aria-checked="true"]') ?? box.current?.querySelector<HTMLElement>('[role=radio], [role=checkbox]');
    el?.focus();
    if (el instanceof HTMLInputElement && el.type === 'text') el.select();
  }, [q.id]);

  if (q.kind === 'text')
    return (
      <div ref={box}>
        <input
          className="wizard-text"
          value={String(value ?? '')}
          placeholder={q.placeholder ?? (q.list ? 'Names, separated by commas' : undefined)}
          aria-labelledby="wizard-q"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) (e.preventDefault(), onEnter());
          }}
        />
        {q.list && (
          <div className="wizard-names" aria-hidden="true">
            {String(value ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s, i) => (
                <span key={`${s}${i}`} className="chip">
                  {s}
                </span>
              ))}
          </div>
        )}
      </div>
    );

  if (q.kind === 'number') {
    const n = Number(value);
    const step = (d: number) => onChange(Math.min(q.max, Math.max(q.min, n + d)));
    return (
      <div
        ref={box}
        className="wizard-number"
        onKeyDown={(e) => {
          // Arrows count from anywhere in the row, the − and + buttons included.
          const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
          if (d) (e.preventDefault(), step(d));
          else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement)) (e.preventDefault(), onEnter());
        }}
      >
        <button className="icon-button" onClick={() => step(-1)} disabled={n <= q.min} aria-label="Fewer">
          −
        </button>
        <input
          type="number"
          min={q.min}
          max={q.max}
          value={n}
          aria-labelledby="wizard-q"
          onChange={(e) => e.target.value !== '' && onChange(Math.min(q.max, Math.max(q.min, Math.round(Number(e.target.value)))))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) (e.preventDefault(), onEnter());
          }}
        />
        <button className="icon-button" onClick={() => step(1)} disabled={n >= q.max} aria-label="More">
          +
        </button>
        <span className="fine">
          {q.min}–{q.max}
          {q.unit ? ` ${q.unit}` : ''}
        </span>
      </div>
    );
  }

  // Choice, yes/no and multi: a list of big options; arrows move, numbers pick, Enter goes on.
  const options = q.kind === 'yesno' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : q.options;
  const multi = q.kind === 'multi';
  const on = (v: string) => (multi ? (value as string[]).includes(v) : q.kind === 'yesno' ? (value ? 'yes' : 'no') === v : value === v);
  const choose = (v: string) => {
    if (multi) {
      const list = value as string[];
      // In the order of the options, so the YAML does not depend on the order of clicks.
      onChange(options.map((o) => o.value).filter((o) => (o === v ? !list.includes(o) : list.includes(o))));
    } else onChange(q.kind === 'yesno' ? v === 'yes' : v);
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = digit(e);
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    const items = [...(box.current?.querySelectorAll<HTMLElement>('.wizard-option') ?? [])];
    if (d >= 0 && d < options.length) {
      e.preventDefault();
      choose(options[d]!.value);
      items[d]?.focus();
    } else if (q.kind === 'yesno' && /^[yn]$/i.test(e.key) && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      choose(e.key.toLowerCase() === 'y' ? 'yes' : 'no');
      items[e.key.toLowerCase() === 'y' ? 0 : 1]?.focus();
    } else if (move) {
      e.preventDefault();
      const j = (i + move + options.length) % options.length;
      items[j]?.focus();
      // A single choice follows the focus, as radio buttons do; a multi waits for Space.
      if (!multi) choose(options[j]!.value);
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onEnter();
    } else if (e.key === ' ') {
      e.preventDefault();
      choose(options[i]!.value);
    }
  };
  return (
    <div ref={box} className="wizard-options" role={multi ? 'group' : 'radiogroup'} aria-labelledby="wizard-q">
      {options.map((o, i) => (
        <button
          key={o.value}
          role={multi ? 'checkbox' : 'radio'}
          aria-checked={on(o.value)}
          className={on(o.value) ? 'wizard-option active' : 'wizard-option'}
          tabIndex={on(o.value) || (i === 0 && !options.some((x) => on(x.value))) ? 0 : -1}
          onClick={() => choose(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          <span className="wizard-mark" aria-hidden="true">
            {on(o.value) && <Icon name="check" size={13} />}
          </span>
          <span className="wizard-option-text">
            <strong>{o.label}</strong>
            {'help' in o && o.help && <span>{o.help}</span>}
          </span>
          {i < 9 && <kbd>{q.kind === 'yesno' ? (i === 0 ? 'Y' : 'N') : i + 1}</kbd>}
        </button>
      ))}
      {multi && <p className="fine">Space or a number turns one on or off; Enter goes on.</p>}
    </div>
  );
}
