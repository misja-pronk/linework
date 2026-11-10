// Starting a diagram in steps: pick the type (what do you want to draw?), a template of it, how to work
// (describe it to AI, build it visually, write YAML, or for some types a wizard), and for AI answer a few questions. The answers
// become a prompt that Claude runs here with your own key, or that you copy into any chat and paste the answer back. A wizard
// (wizard.tsx) needs no AI: its answers make the YAML directly.
import { useEffect, useMemo, useRef, useState } from 'react';
import { render, types } from '@cartography/engine';
import { matchTypes, type DiagramType, type LayoutSidecar } from '@cartography/core';
import { blankText, exampleLoader, starters, typeName, type Starter } from './library.ts';
import { Icon } from './icon.tsx';
import { useRestoreFocus } from './menu.tsx';
import { store } from './store.ts';
import { questionsFor, type Question } from './ai/questions.ts';
import { buildPrompt, extractYaml, promptText, type Answers } from './ai/prompt.ts';
import { failure, generate, MODELS, type ModelId } from './ai/claude.ts';
import { importText } from '@cartography/import';
import { importDrawio, importExcalidraw, isDrawio, isExcalidraw } from '@cartography/interop';
import { wizardsFor } from '@cartography/wizards';
import { WizardSteps } from './wizard.tsx';
import { say, t } from './i18n/index.ts';

export type View = 'visual' | 'code';

export interface Opened {
  text: string;
  name: string;
  /** The template it came from, for files next to bundled examples. */
  starter?: string;
  view: View;
  /** A new, empty diagram: nothing worth an "undo open". */
  blank?: boolean;
  /** Where the shapes stood in the drawing it was imported from, when that was asked for. */
  pins?: LayoutSidecar;
}

const thumbs = new Map<string, string>();
let thumbIds = 0;

/** A drawing of some YAML, kept while the next one is on its way. */
function useDrawing(text: string | undefined, theme: 'light' | 'dark', load?: (f: string) => string, sidecar?: LayoutSidecar) {
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
        sidecar,
      }).catch(() => undefined);
      if (stop || !r) return;
      if (r.svg) setSvg(r.svg);
      setErrors(r.diagnostics.filter((d) => d.severity === 'error').map((d) => (d.line ? t('Line {line}: {message}', { line: d.line, message: d.message }) : d.message)));
    }, 250);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [text, theme, load, sidecar]);
  return { svg, errors };
}

const MODES = [
  {
    view: 'ai',
    icon: 'sparkles',
    title: 'Ask Claude',
    text: 'Describe it in a few answers; Claude drafts the diagram for you to refine.',
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

/** For types with a wizard (Azure landing zone, C4, data mesh, …): questions in, a finished drawing out, no AI. */
const WIZARD_MODE = {
  view: 'wizard',
  icon: 'list-checks',
  title: 'Answer questions',
  text: 'A wizard after a reference architecture; the drawing grows as you answer. No AI, no key.',
  key: '4',
} as const;
type ModeView = (typeof MODES)[number]['view'] | 'wizard';

type Step = 'type' | 'pick' | 'mode' | 'ask' | 'import' | 'wizard';
const PREVIOUS: Partial<Record<Step, Step>> = { ask: 'mode', mode: 'pick', pick: 'type', import: 'type', wizard: 'mode' };

/**
 * `current` is the type of the open diagram: marked on its card, so the dialog doubles as the guide
 * the editor's type pill points to.
 */
/** A file from another tool, opened or dropped: it starts in the Import panel. */
export interface Incoming {
  text: string;
  name: string;
}

export function Start({ theme, initial, incoming, current, onOpen, onClose }: { theme: 'light' | 'dark'; initial?: Starter; incoming?: Incoming; current?: string; onOpen(o: Opened): void; onClose(): void }) {
  const [starter, setStarter] = useState<Starter | undefined>(initial);
  /** The chosen type, or 'all' to browse every template. */
  const [typeId, setTypeId] = useState<string>(initial?.type ?? 'all');
  const [step, setStep] = useState<Step>(incoming ? 'import' : initial ? 'mode' : 'type');
  /** A wizard's drawing that the AI mode starts from ("Ask Claude to refine it"). */
  const [draft, setDraft] = useState<string>();
  useRestoreFocus();

  // Esc goes one step back, then closes.
  const back = () => (step === 'ask' && draft ? setStep('wizard') : PREVIOUS[step] ? setStep(PREVIOUS[step]) : onClose());
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
    if (mode === 'wizard') return setStep('wizard');
    if (mode === 'ai') return (setDraft(undefined), setStep('ask'));
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
      <div className={`templates start step-${step}`} role="dialog" aria-label={t('Start a diagram')} onMouseDown={(e) => e.stopPropagation()}>
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
                : step === 'import'
                  ? t('Import from Mermaid, D2, PlantUML, draw.io or Excalidraw')
                  : step === 'mode'
                    ? `${starter!.title}`
                    : step === 'wizard'
                      ? t('Answer questions · {type}', { type: typeName(starter!.type) })
                      : t('Ask Claude · {type}', { type: typeName(starter!.type) })}
          </h2>
          {step !== 'import' && (
            <ol className="steps" aria-label={t('Steps')}>
              {['Type', 'Template', 'How', ...(step === 'ask' ? ['Describe'] : step === 'wizard' ? ['Questions'] : [])].map((s, i) => (
                <li key={s} aria-current={i === ['type', 'pick', 'mode', step === 'wizard' ? 'wizard' : 'ask'].indexOf(step)}>
                  {say(s)}
                </li>
              ))}
            </ol>
          )}
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
            onImport={() => setStep('import')}
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
        {step === 'import' && <Import theme={theme} incoming={incoming} onOpen={onOpen} />}
        {step === 'mode' && starter && (
          <Mode
            starter={starter}
            theme={theme}
            onChoose={choose}
            onBlank={() => onOpen({ text: blankText(starter.type), name: `${starter.type}.yaml`, view: 'visual', blank: true })}
          />
        )}
        {step === 'ask' && starter && type && <Ask starter={starter} type={type} theme={theme} onOpen={onOpen} draft={draft} />}
        {step === 'wizard' && starter && (
          <WizardSteps
            wizards={wizardsFor(starter.type)}
            theme={theme}
            onOpen={(r) => onOpen({ text: r.yaml, name: r.name, view: r.view })}
            onAsk={(r) => {
              setDraft(r.yaml);
              setStep('ask');
            }}
          />
        )}
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
function Types({ theme, current, last, onChoose, onImport }: { theme: 'light' | 'dark'; current?: string; last: string; onChoose(id: string): void; onImport(): void }) {
  const [query, setQuery] = useState('');
  const ranked = useMemo(() => matchTypes(query, types), [query]);
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
        <button className="chip import-chip" onClick={onImport} title={t('Paste a Mermaid, D2 or PlantUML diagram, or open a draw.io or Excalidraw file, and get it back as Cartography')}>
          <Icon name="clipboard-paste" size={13} /> {t('Import from Mermaid, D2, PlantUML, draw.io or Excalidraw')}
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
                  {t('{count} start|{count} starts', { count: typeCount(ty.id) })}
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
  const modes = useMemo(() => (wizardsFor(starter.type).length ? [...MODES, WIZARD_MODE] : MODES), [starter.type]);
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

type Phase =
  { at: 'form' } | { at: 'running'; text: string; attempt: number } | { at: 'paste' } | { at: 'done'; yaml: string; errors: string[] } | { at: 'failed'; message: string };

function Ask({ starter, type, theme, onOpen, draft }: { starter: Starter; type: DiagramType; theme: 'light' | 'dark'; onOpen(o: Opened): void; draft?: string }) {
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
  const prompt = useMemo(() => buildPrompt(type, questions, answers, starter.text, draft), [type, questions, answers, starter, draft]);
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
            <Icon name="sparkles" size={16} /> {t('Generate with Claude')}
          </h3>
          <label className="ask-field">
            <span className="ask-label">{t('Anthropic API key')}</span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} />
          </label>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('Remember in this browser')}
          </label>
          <label className="ask-field">
            <span className="ask-label">{t('Model')}</span>
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
              {t('No key?')}{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                {t('Get a key ↗')}
              </a>{' '}
              {t('or copy the prompt into any chat assistant below.')}
            </p>
          )}
          <button className={hasKey ? 'button primary wide' : 'button ghost wide'} onClick={() => void run()} disabled={!hasKey} title={hasKey ? undefined : t('Enter an API key first')}>
            <Icon name="sparkles" /> {t('Generate')} <kbd>⌘↵</kbd>
          </button>
          <p className="fine">{t('Your answers and key go only to api.anthropic.com, and only when you press Generate. Everything else stays in this browser.')}</p>
          {phase.at === 'failed' && (
            <p className="callout error" role="alert">
              <Icon name="circle-exclamation-point" size={14} /> <span>{phase.message}</span>
            </p>
          )}
          <div className="or">
            <span>{t('or use any chat assistant')}</span>
          </div>
          <button className={hasKey ? 'button ghost wide' : 'button primary wide'} onClick={() => void copy()}>
            <Icon name="copy" /> {t('Copy the prompt')}
          </button>
          {!hasKey && <p className="fine">{t('Paste it into Claude or another assistant, then paste its answer back here.')}</p>}
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
              <span className="pulse" /> {phase.attempt > 1 ? (phase.attempt - 1 === 1 ? t('Fixing a problem…') : t('Fixing problems…')) : t('Claude is drawing…')}
            </>
          ) : phase.at === 'paste' ? (
            <>
              <Icon name="clipboard-paste" size={14} /> {copied ? t('Prompt copied. Paste the answer here') : t('Paste the answer here')}
            </>
          ) : phase.errors.length ? (
            <>
              <Icon name="triangle-exclamation-point" size={14} /> {t('Almost: {count} problem left to fix in the editor|Almost: {count} problems left to fix in the editor', { count: phase.errors.length })}
            </>
          ) : (
            <>
              <Icon name="check" size={14} /> {t('Ready')}
            </>
          )}
        </div>
        {phase.at === 'paste' ? (
          <textarea
            className="paste mono"
            autoFocus
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={t('Paste the whole answer; the YAML is taken out of it.')}
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
            <p className="fine">{t('Nothing to draw until the problem below is fixed. Open it in YAML to fix it there.')}</p>
          ) : (
            <div className="thumb-wait" />
          )}
        </div>
        {!busy && shown && drawing.errors.length > 0 && <p className="fine">{drawing.errors[0]}</p>}
        <footer>
          {busy ? (
            <button className="button ghost" onClick={() => abort.current?.abort()}>
              <Icon name="circle-stop" /> {t('Stop')}
            </button>
          ) : (
            <>
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

/** One diagram out of what was pasted: a Mermaid block, a draw.io page, an Excalidraw scene. */
interface Imported {
  yaml: string;
  /** What was left out or changed; for a drawing the whole report, what was mapped first. */
  warnings: string[];
  name?: string;
  pins?: LayoutSidecar;
}

/** Paste Mermaid (or Markdown with mermaid blocks), or a draw.io or Excalidraw file, and see it as Cartography right away. */
function Import({ theme, incoming, onOpen }: { theme: 'light' | 'dark'; incoming?: Incoming; onOpen(o: Opened): void }) {
  const [text, setText] = useState(incoming?.text ?? '');
  const [file, setFile] = useState<string | undefined>(incoming?.name);
  const [block, setBlock] = useState(0);
  const [keep, setKeep] = useState(false);
  // A drawing from another tool: XML of draw.io (packed or not) or the JSON of Excalidraw.
  const drawing = useMemo(() => (isExcalidraw(text) ? 'Excalidraw' : isDrawio(text) ? 'draw.io' : undefined), [text]);
  const blocks = useMemo((): Imported[] => {
    if (!text.trim()) return [];
    try {
      if (drawing) {
        const opts = { keepPositions: keep, title: file?.replace(/\.[^.]+$/, '') };
        const pages = drawing === 'Excalidraw' ? [importExcalidraw(text, opts)] : importDrawio(text, opts);
        return pages.map((p) => ({ yaml: p.yaml, warnings: p.report, name: p.name, pins: p.sidecar }));
      }
      // Mermaid, D2, PlantUML or Markdown with their blocks: by the file's ending, or by how the text looks.
      return importText(text, file);
    } catch (e) {
      return [{ yaml: '', warnings: [e instanceof Error ? e.message : String(e)] }];
    }
  }, [text, drawing, keep, file]);
  const current = blocks[Math.min(block, blocks.length - 1)];
  const shown = useDrawing(current?.yaml || undefined, theme, undefined, current?.pins);
  // Named after the file it came from (and the page or block of it, when it has several); pasted text is "imported".
  const stem = (): string | undefined => {
    const base = file?.replace(/\.[^.]+$/, '');
    if (drawing) return current?.name ?? base;
    return blocks.length > 1 && current?.name ? [base, current.name].filter(Boolean).join('-') : base;
  };
  const open = (view: View) => current?.yaml && onOpen({ text: current.yaml, name: `${stem() || 'imported'}.yaml`.replace(/[\\/:\s]+/g, '-'), view, pins: current.pins });
  const choose = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.drawio,.dio,.xml,.excalidraw,.json,.mmd,.mermaid,.d2,.puml,.plantuml,.md';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setFile(f.name);
      setBlock(0);
      setText(await f.text());
    };
    input.click();
  };
  return (
    <div className="ask result">
      <div className="ask-stream">
        <div className="ask-stream-head">
          <Icon name="clipboard-paste" size={14} /> {t('Paste Mermaid, D2 or PlantUML, or open a draw.io or Excalidraw file')}
        </div>
        <textarea
          className="paste mono"
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFile(undefined);
          }}
          placeholder={MERMAID_SAMPLE}
          spellCheck={false}
        />
        <div style={{ display: 'flex', gap: 8, margin: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="button ghost" onClick={choose} title={t('A .drawio, .excalidraw, .mmd, .d2, .puml or .md file from your computer; it is read here, in the browser')}>
            <Icon name="folder-open" /> {t('Choose a file…')}
          </button>
          {!text && (
            <button className="button ghost" onClick={() => setText(MERMAID_SAMPLE)}>
              {t('Try the example')}
            </button>
          )}
          {drawing && (
            <label className="fine" title={t('Pins every shape where it stood in the drawing. Off, Cartography lays it out itself.')}>
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> {t('Keep the positions from {tool}', { tool: drawing })}
            </label>
          )}
        </div>
      </div>
      <div className="ask-preview">
        {blocks.length > 1 && (
          <div className="segmented" role="radiogroup" aria-label={drawing ? t('Page') : t('Diagram')}>
            {blocks.map((b, i) => (
              <button key={i} role="radio" aria-checked={i === block} className={i === block ? 'active' : ''} onClick={() => setBlock(i)}>
                {b.name ?? (drawing ? t('Page {n}', { n: i + 1 }) : t('Block {n}', { n: i + 1 }))}
              </button>
            ))}
          </div>
        )}
        <div className="mode-preview">
          {shown.svg && current?.yaml ? (
            <div dangerouslySetInnerHTML={{ __html: shown.svg }} />
          ) : (
            <p className="fine">{current?.yaml ? (shown.errors[0] ?? t('Drawing…')) : text.trim() ? t('Nothing to draw: see the problem below.') : t('The Cartography version appears here as you paste.')}</p>
          )}
        </div>
        {current && current.warnings.length > 0 && (
          <div className={!current.yaml ? 'callout error' : drawing && current.warnings.length === 1 ? 'callout' : 'callout warn'} role={current.yaml ? 'status' : 'alert'}>
            <Icon name={!current.yaml ? 'circle-exclamation-point' : drawing && current.warnings.length === 1 ? 'check' : 'triangle-exclamation-point'} size={14} />
            <div>
              <strong>
                {!current.yaml
                  ? t('This could not be imported:')
                  : drawing
                    ? t('Read from {tool}:', { tool: drawing })
                    : t('One thing was left out or changed:|{count} things were left out or changed:', { count: current.warnings.length })}
              </strong>
              <ul className="warnings">
                {current.warnings.slice(0, drawing ? 6 : 4).map((w) => (
                  <li key={w}>{sentence(w)}</li>
                ))}
                {current.warnings.length > (drawing ? 6 : 4) && <li>{t('…and {count} more', { count: current.warnings.length - (drawing ? 6 : 4) })}</li>}
              </ul>
            </div>
          </div>
        )}
        <footer>
          <span className="spacer" />
          <button className="button ghost" disabled={!current?.yaml} onClick={() => open('code')}>
            <Icon name="code" /> {t('Open in YAML')}
          </button>
          <button className="button primary" disabled={!current?.yaml} onClick={() => open('visual')}>
            <Icon name="mouse-pointer-2" /> {t('Open in builder')}
          </button>
        </footer>
      </div>
    </div>
  );
}
