// Starting a diagram in steps: pick the type (what do you want to draw?), a template of it, how to work
// (describe it to your own AI, build it visually, or write YAML). For your AI a few answers become a
// prompt to copy into any chat; its answer is pasted back. Cartography sends nothing anywhere itself.
import './start.css';
import './start-types.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { render, types } from '@cartography/engine';
import { matchTypes, type DiagramType } from '@cartography/core';
import { blankText, exampleLoader, starters, typeName, type Starter } from './library.ts';
import { Icon } from './icon.tsx';
import { useModal } from './menu.tsx';
import { store } from './store.ts';
import { questionsFor, type Question } from './ai/questions.ts';
import { buildPrompt, extractYaml, promptText, type Answers } from './ai/prompt.ts';
import { say, t, uiLang } from './i18n/index.ts';
import { englishQuery } from './i18n/query-nl.ts';

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
    const timer = setTimeout(async () => {
      const r = await render(text, {
        theme,
        fonts: 'none',
        idPrefix: `s${thumbIds++}`,
        load,
      }).catch(() => undefined);
      if (stop || !r) return;
      if (r.svg) setSvg(r.svg);
      setErrors(r.diagnostics.filter((d) => d.severity === 'error').map((d) => (d.line ? t('Line {line}: {message}', { line: d.line, message: d.message }) : d.message)));
    }, 250);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [text, theme, load]);
  return { svg, errors };
}

const MODES = [
  {
    view: 'ai',
    icon: 'sparkles',
    title: 'Your AI',
    text: 'Describe it in a few answers, copy them into your own AI, and paste the diagram it writes back here.',
    key: '1',
  },
  {
    view: 'visual',
    icon: 'mouse-pointer-2',
    title: 'Builder',
    text: 'Build visually: drag shapes from the palette, connect them, edit in the panel. No YAML needed.',
    key: '2',
  },
  {
    view: 'code',
    icon: 'code',
    title: 'YAML',
    text: 'Write it, starting from this example, with autocomplete and a live drawing next to it.',
    key: '3',
  },
] as const;

type ModeView = (typeof MODES)[number]['view'];

type Step = 'type' | 'pick' | 'mode' | 'ask';
const PREVIOUS: Partial<Record<Step, Step>> = { ask: 'mode', mode: 'pick', pick: 'type' };

/**
 * `current` is the type of the open diagram: marked on its card, so the dialog doubles as the guide
 * the editor's type pill points to.
 */
export function Start({ theme, initial, current, onOpen, onClose }: { theme: 'light' | 'dark'; initial?: Starter; current?: string; onOpen(o: Opened): void; onClose(): void }) {
  const [starter, setStarter] = useState<Starter | undefined>(initial);
  /** The chosen type, or 'all' to browse every template. */
  const [typeId, setTypeId] = useState<string>(initial?.type ?? 'all');
  const [step, setStep] = useState<Step>(initial ? 'mode' : 'type');
  const modal = useModal();

  // Esc goes one step back, then closes.
  const back = () => (PREVIOUS[step] ? setStep(PREVIOUS[step]) : onClose());
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
  const choose = (mode: ModeView) => {
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
      <div className={`templates start step-${step}`} role="dialog" aria-modal="true" ref={modal} aria-label={t('Start a diagram')} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          {step !== 'type' && (
            <button className="icon-button" onClick={back} aria-label={t('Back')} title={t('Back (Esc)')}>
              <Icon name="arrow-left" />
            </button>
          )}
          <h2>
            {step === 'type'
              ? t('What do you want to draw?')
              : step === 'pick'
                ? typeId === 'all'
                  ? t('All templates and examples')
                  : t('{type}: pick a start', { type: typeName(typeId) })
                : step === 'mode'
                  ? `${starter!.title}`
                  : t('Your AI · {type}', { type: typeName(starter!.type) })}
          </h2>
          <ol className="steps" aria-label={t('Steps')}>
            {['Type', 'Template', 'How', ...(step === 'ask' ? ['Describe'] : [])].map((s, i) => (
              <li key={s} aria-current={i === ['type', 'pick', 'mode', 'ask'].indexOf(step)}>
                {say(s)}
              </li>
            ))}
          </ol>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </header>
        {step === 'type' && (
          <Types
            theme={theme}
            current={current}
            last={typeId}
            onChoose={(t) => {
              setTypeId(t);
              setStep('pick');
            }}
          />
        )}
        {step === 'pick' && (
          <Pick
            theme={theme}
            typeId={typeId}
            onType={setTypeId}
            onPick={(s) => {
              setStarter(s);
              setStep('mode');
            }}
          />
        )}
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

/** Drawings of starters, one by one, so the dialog opens at once and fills in. */
function useThumbs(list: Starter[], theme: 'light' | 'dark') {
  const [, redraw] = useState(0);
  const ids = list.map((s) => s.id).join('|');
  useEffect(() => {
    let stop = false;
    (async () => {
      for (const s of list) {
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
  }, [ids, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  return (s: Starter, box?: { w: number; h: number }) => filled(thumbs.get(`${theme}:${s.id}`), box);
}

/**
 * A thumbnail big enough to read: a drawing that would shrink below a third of its size shows its middle
 * at that size instead of the whole of it, filling the card (`box`: the card's thumbnail area in px).
 */
function filled(svg: string | undefined, box = { w: 240, h: 130 }): string | undefined {
  const m = svg && /^<svg[^>]*\sviewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!svg || !m) return svg;
  const [w, h] = [Number(m[1]), Number(m[2])];
  const fit = Math.min(box.w / w, box.h / h);
  const scale = Math.max(fit, 0.3);
  if (scale <= fit * 1.05) return svg;
  const vw = Math.min(w, box.w / scale);
  const vh = Math.min(h, box.h / scale);
  const view = `${((w - vw) / 2).toFixed(1)} ${((h - vh) / 2).toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`;
  return svg.replace(/viewBox="[^"]*"/, `viewBox="${view}" preserveAspectRatio="xMidYMid slice"`);
}

/** Arrow keys through a grid of cards; columns from the layout (cards on the first row share its top). Returns the new index. */
function moveInGrid(e: React.KeyboardEvent, cards: HTMLElement[]): number | undefined {
  const i = cards.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const top = (c: HTMLElement) => Math.round(c.getBoundingClientRect().top);
  const cols = Math.max(1, cards.filter((c) => top(c) === top(cards[0]!)).length);
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: cards.length - 1 - i }[e.key];
  if (step == null) return;
  e.preventDefault();
  const next = Math.min(cards.length - 1, Math.max(0, i + step));
  cards[next]!.focus();
  return next;
}

const typeCount = (id: string) => starters.filter((s) => s.type === id).length;
/** "Not for" pointers to types that exist; a pointer to a type not (yet) registered stays plain text. */
const pointsTo = (use?: string) => (use && types.some((t) => t.id === use) ? use : undefined);
const typeTemplates = types.map((t) => starters.find((s) => s.id === `template:${t.id}`)).filter((s): s is Starter => !!s);

/** Step one: what do you want to draw? A card per type says what it is for and what it is not for. */
function Types({ theme, current, last, onChoose }: { theme: 'light' | 'dark'; current?: string; last: string; onChoose(id: string): void }) {
  const [query, setQuery] = useState('');
  const ranked = useMemo(() => matchTypes(uiLang() === 'nl' ? englishQuery(query) : query, types), [query]);
  const matched = ranked[0]!.score > 0;
  const [flash, setFlash] = useState<string>();
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const thumb = useThumbs(typeTemplates, theme);
  const card = (id: string) => grid.current?.querySelector<HTMLElement>(`[data-type="${id}"]`);
  // Back from a type's templates lands on that type; a fresh start on the search box.
  useEffect(() => {
    const back = last !== 'all' ? card(last)?.querySelector<HTMLElement>('.type-main') : undefined;
    (back ?? search.current)?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** "Not for → X": show X and put focus on it, so Enter opens it. */
  const jump = (id: string) => {
    const el = card(id);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el?.querySelector<HTMLElement>('.type-main')?.focus({ preventScroll: true });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? undefined : f)), 1400);
  };
  const mains = () => [...(grid.current?.querySelectorAll<HTMLElement>('.type-main') ?? [])];
  const onGridKey = (e: React.KeyboardEvent) => {
    const all = mains();
    // Up from the first row goes back to the search box.
    if (e.key === 'ArrowUp' && all.indexOf(document.activeElement as HTMLElement) >= 0) {
      const top = (c: HTMLElement) => Math.round(c.getBoundingClientRect().top);
      if (top(document.activeElement as HTMLElement) === top(all[0]!)) return (e.preventDefault(), search.current?.focus());
    }
    moveInGrid(e, all);
  };
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onChoose(ranked[0]!.type.id);
    else if (e.key === 'ArrowDown') mains()[0]?.focus();
    else if (e.key === 'Escape' && query) setQuery('');
    else return;
    e.preventDefault();
  };

  return (
    <>
      <div className="type-search">
        <label className="search-field">
          <Icon name="search" size={15} />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={t('Describe what you want to show')}
            aria-label={t('Describe what you want to show')}
            spellCheck={false}
          />
        </label>
        <button className="chip import-chip" onClick={() => onChoose('all')} title={t('Every template and example, of every type')}>
          <Icon name="layout-grid" size={13} /> {t('All templates')}
        </button>
      </div>
      <p className="type-hint" role="status">
        {!query ? (
          <>
            {t('Try “tables and keys” or “who has access”. Not sure?')} <strong>Architecture</strong> {t('fits most systems.')}
          </>
        ) : matched ? (
          <>
            {t('Best match:')} <strong>{ranked[0]!.type.name}</strong>. <kbd>↵</kbd> {t('opens it.')}
          </>
        ) : (
          <>{t('No type matches those words. Architecture fits most systems.')}</>
        )}
      </p>
      <div className="type-grid" ref={grid} onKeyDown={onGridKey}>
        {ranked.map(({ type: ty, score }, i) => {
          const s = typeTemplates.find((x) => x.type === ty.id);
          const svg = s && thumb(s, { w: 222, h: 80 });
          const notFor = ty.notFor ?? [];
          const cls = ['type-card', matched && i === 0 && 'best', matched && score < ranked[0]!.score / 2 && 'faded', flash === ty.id && 'flash', ty.id === current && 'current'];
          return (
            <div key={ty.id} className={cls.filter(Boolean).join(' ')} data-type={ty.id}>
              <button className="type-main" onClick={() => onChoose(ty.id)}>
                <span className="type-thumb" aria-hidden="true">
                  {svg ? <span dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="thumb-wait" />}
                </span>
                <span className="type-head">
                  <span className="type-icon">
                    <Icon name={ty.icon ?? 'layout-template'} size={17} />
                  </span>
                  <span className="type-name">{ty.name}</span>
                  {matched && i === 0 ? <span className="type-badge">{t('Best match')}</span> : ty.id === current ? <span className="type-badge quiet">{t('This diagram')}</span> : null}
                </span>
                <span className="type-tagline">
                  <code className="type-yaml" title={t('What the YAML says')}>type: {ty.id}</code>
                  {ty.tagline && <> · {ty.tagline}</>}
                </span>
                {!!ty.useWhen?.length && (
                  <span className="type-use" title={ty.useWhen.length > 2 ? ty.useWhen.join('\n') : undefined}>
                    <span className="type-label">{t('Use when')}</span>
                    {ty.useWhen.slice(0, 2).map((u) => (
                      <span key={u} className="type-bullet">
                        {u}
                      </span>
                    ))}
                  </span>
                )}
              </button>
              <div className="type-foot">
                {/* Where to go instead, as links; what each is for is in its tooltip. Compact, so more types fit. */}
                {notFor.some((n) => pointsTo(n.use)) && (
                  <div className="type-not">
                    <span className="type-label">{t('Not for this? Try')}</span>
                    <span className="type-not-links">
                      {notFor.map((n) => {
                        const use = pointsTo(n.use);
                        return (
                          use && (
                            <button key={n.text} className="link" onClick={() => jump(use)} title={`${n.text}: ${typeName(use)}`}>
                              → {typeName(use)}
                            </button>
                          )
                        );
                      })}
                    </span>
                  </div>
                )}
                <span className="type-count">
                  {t('{count} template|{count} templates', { count: typeCount(ty.id) })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** The chosen type's guidance again, compact, above its templates; "Not for" switches type in place. */
function TypeSummary({ type, onType }: { type: DiagramType; onType(id: string): void }) {
  const notFor = (type.notFor ?? []).filter((n) => pointsTo(n.use));
  return (
    <div className="type-summary">
      <span className="type-icon">
        <Icon name={type.icon ?? 'layout-template'} size={17} />
      </span>
      <div>
        <p>
          <strong>{type.name}</strong>
          {type.tagline && <> · {type.tagline}</>}
        </p>
        {!!type.useWhen?.length && (
          <p className="type-facts">
            <span className="type-label">{t('Use when')}</span> {type.useWhen.join(' · ')}
          </p>
        )}
        {notFor.length > 0 && (
          <p className="type-facts">
            <span className="type-label">{t('Not for')}</span>{' '}
            {notFor.map((n, i) => (
              <span key={n.text}>
                {i > 0 && ' · '}
                {n.text}{' '}
                <button className="link" onClick={() => onType(n.use!)}>
                  → {typeName(n.use!)}
                </button>
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/** Step two: the chosen type's template and examples (or all of them). */
function Pick({ theme, typeId, onType, onPick }: { theme: 'light' | 'dark'; typeId: string; onType(id: string): void; onPick(s: Starter): void }) {
  const type = types.find((t) => t.id === typeId);
  const shown = useMemo(() => starters.filter((s) => typeId === 'all' || s.type === typeId), [typeId]);
  const thumb = useThumbs(shown, theme);
  /** Roving focus: one card is in the Tab order, arrows move between them. */
  const [active, setActive] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setActive(0);
    grid.current?.querySelector<HTMLElement>('.template-card')?.focus();
  }, [typeId]);
  const onGridKey = (e: React.KeyboardEvent) => {
    const next = moveInGrid(e, [...(grid.current?.querySelectorAll<HTMLElement>('.template-card') ?? [])]);
    if (next != null) setActive(next);
  };

  return (
    <>
      {type ? (
        <TypeSummary type={type} onType={onType} />
      ) : (
        <nav className="chips">
          <div className="chip-row" role="group" aria-label={t('Diagram type')}>
            {types.map((t) => (
              <button key={t.id} className="chip" onClick={() => onType(t.id)} title={t.tagline}>
                {t.name}
              </button>
            ))}
          </div>
        </nav>
      )}
      <div className="template-grid" ref={grid} onKeyDown={onGridKey}>
        {shown.map((s, i) => {
          const svg = thumb(s);
          // Two of the same title (a web shop as a system and as its deployment): the subtitle tells them apart.
          const twin = s.subtitle && shown.some((o) => o !== s && o.title === s.title);
          return (
            <button key={s.id} className="template-card" onClick={() => onPick(s)} autoFocus={i === 0} tabIndex={i === active ? 0 : -1} onFocus={() => setActive(i)}>
              <div className="thumb" aria-hidden="true">
                {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="thumb-wait" />}
              </div>
              <div className="template-meta">
                <span className="template-title">
                  {s.title}
                  {twin && <span className="template-twin"> · {s.subtitle}</span>}
                </span>
                <span className="template-sub" title={s.kind === 'example' ? s.file : undefined}>
                  {s.kind === 'template' ? t('Template') : t('Example')}
                  {type ? (s.kind === 'template' ? t(': the smallest start') : ` · ${s.file}`) : ` · ${typeName(s.type)}`}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Mode({ starter, theme, onChoose, onBlank }: { starter: Starter; theme: 'light' | 'dark'; onChoose(m: ModeView): void; onBlank(): void }) {
  const load = useMemo(() => exampleLoader(starter.id), [starter.id]);
  const { svg } = useDrawing(starter.text, theme, load);
  const modes = MODES;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const m = modes.find((x) => x.key === e.key);
      if (m) onChoose(m.view);
      else if (e.key === 'b') onBlank();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose, onBlank, modes]);
  return (
    <div className="mode-step">
      <div className="mode-preview">{svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="thumb-wait" />}</div>
      <div className="modes" role="group" aria-label={t('How do you want to work?')}>
        <p className="modes-intro">{t('How do you want to work?')}</p>
        {modes.map((m, i) => (
          <button key={m.view} className={`mode-card mode-${m.view}`} onClick={() => onChoose(m.view)} autoFocus={i === 0}>
            <span className="mode-icon">
              <Icon name={m.icon} size={20} />
            </span>
            <span className="mode-text">
              <strong>{say(m.title)}</strong>
              <span>{say(m.text)}</span>
            </span>
            <kbd>{m.key}</kbd>
          </button>
        ))}
        <button className="blank-start" onClick={onBlank}>
          <Icon name="file-plus" size={16} />
          <span>
            {t('Or')} <strong>{t('start blank')}</strong>{t(': an empty {type} in the builder', { type: typeName(starter.type).toLowerCase() })}
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
          {t('{count} more…', { count: options.length - shown.length })}
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

type Phase = { at: 'form' } | { at: 'paste' };

function Ask({ starter, type, theme, onOpen }: { starter: Starter; type: DiagramType; theme: 'light' | 'dark'; onOpen(o: Opened): void }) {
  const questions = useMemo(() => questionsFor(type), [type]);
  const [answers, setAnswers] = useState<Answers>(() => ({
    ...Object.fromEntries(questions.filter((q) => q.initial).map((q) => [q.id, q.initial!])),
    ...(store.get<Record<string, Answers>>('ai-answers')?.[type.id] ?? {}),
  }));
  const [phase, setPhase] = useState<Phase>({ at: 'form' });
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);

  // The template's own YAML shows the model the style; an empty start teaches nothing, so use the type's template.
  const prompt = useMemo(() => buildPrompt(type, questions, answers, starter.text), [type, questions, answers, starter]);
  const load = useMemo(() => exampleLoader(starter.id), [starter.id]);
  const shown = phase.at === 'paste' && pasted.trim() ? extractYaml(pasted) : undefined;
  const drawing = useDrawing(shown, theme, load);

  const keep = () => {
    const all = store.get<Record<string, Answers>>('ai-answers') ?? {};
    store.set('ai-answers', { ...all, [type.id]: answers });
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

  if (phase.at === 'form')
    return (
      <div className="ask">
        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            void copy();
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
            <Icon name="sparkles" size={16} /> {t('Your own AI')}
          </h3>
          <p className="fine">{t('Copy the prompt (your answers, the type’s schema and an example) into any AI chat, then paste its answer back here.')}</p>
          <button className="button primary wide" onClick={() => void copy()}>
            <Icon name="copy" /> {t('Copy the prompt')} <kbd>⌘↵</kbd>
          </button>
          <p className="fine">{t('Working in Claude Code, Copilot or Cursor? Connect Cartography’s MCP server instead: your agent then writes and checks the diagram itself (docs/ai.md).')}</p>
          <div className="or">
            <span>{t('already have the YAML?')}</span>
          </div>
          <button className="button ghost wide" onClick={() => setPhase({ at: 'paste' })}>
            <Icon name="clipboard-paste" /> {t('Paste an answer')}
          </button>
          <KeyHint onRun={() => void copy()} />
        </aside>
      </div>
    );

  return (
    <div className="ask result">
      <div className="ask-stream">
        <div className="ask-stream-head">
          <Icon name="clipboard-paste" size={14} /> {copied ? t('Prompt copied. Paste the answer here') : t('Paste the answer here')}
        </div>
        <textarea
          className="paste mono"
          autoFocus
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={t('Paste the whole answer; the YAML is taken out of it.')}
          spellCheck={false}
        />
      </div>
      <div className="ask-preview">
        <div className="mode-preview">
          {drawing.svg ? (
            <div dangerouslySetInnerHTML={{ __html: drawing.svg }} />
          ) : shown && drawing.errors.length ? (
            <p className="fine">{t('Nothing to draw until the problem below is fixed. Open it in YAML to fix it there.')}</p>
          ) : (
            <div className="thumb-wait" />
          )}
        </div>
        {shown && drawing.errors.length > 0 && <p className="fine">{drawing.errors[0]}</p>}
        <footer>
          <button className="button ghost" onClick={() => setPhase({ at: 'form' })}>
            <Icon name="arrow-left" /> {t('Change answers')}
          </button>
          <span className="spacer" />
          <button className="button ghost" disabled={!shown} onClick={() => shown && open(shown, 'code')}>
            <Icon name="code" /> {t('Open in YAML')}
          </button>
          <button className="button primary" disabled={!shown} onClick={() => shown && open(shown, 'visual')}>
            <Icon name="mouse-pointer-2" /> {t('Open in builder')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** ⌘↵ copies the prompt from anywhere in the form. */
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

