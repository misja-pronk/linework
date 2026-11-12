// Starting a diagram: one screen of the drawings people come to make, each a card that opens a ready
// example in the editor; below them a blank sheet and a search by what you want to show. Every template
// and example, by type, is one step further ("All templates"). Nothing here asks how to work: the
// editor has the drawing, the YAML and "copy for your AI" itself.
import './start.css';
import './start-types.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { render, types } from '@cartography/engine';
import { matchTypes, type DiagramType } from '@cartography/core';
import { blankText, exampleLoader, starters, typeName, type Starter } from './library.ts';
import { SCENARIOS, exampleAt } from './scenarios.ts';
import { Icon } from './icon.tsx';
import { BrandMark } from './brand-mark.tsx';
import { useModal } from './menu.tsx';
import { say, t, uiLang } from './i18n/index.ts';
import { englishQuery } from './i18n/query-nl.ts';

export type View = 'visual' | 'code';

export interface Opened {
  text: string;
  name: string;
  /** What to call it once open ("Opened Hub and spoke"). */
  title?: string;
  /** The template it came from, for files next to bundled examples. */
  starter?: string;
  view: View;
  /** A new, empty diagram: nothing worth saying it opened. */
  blank?: boolean;
}

const thumbs = new Map<string, string>();
let thumbIds = 0;

type Step = 'home' | 'type' | 'pick';
const PREVIOUS: Partial<Record<Step, Step>> = { pick: 'type', type: 'home' };

/**
 * `current` is the type of the open diagram: asked for from the editor's type pill, the dialog opens on
 * the types with its card marked, so it doubles as the guide the pill points to.
 */
export function Start({ theme, current, onOpen, onClose }: { theme: 'light' | 'dark'; current?: string; onOpen(o: Opened): void; onClose(): void }) {
  /** The chosen type, or 'all' to browse every template. */
  const [typeId, setTypeId] = useState<string>('all');
  const [step, setStep] = useState<Step>(current ? 'type' : 'home');
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

  // A template opens in the editor at once, on the drawing: the template is the start.
  const open = (s: Starter) => onOpen({ text: s.text, name: s.file, title: s.title, starter: s.id, view: 'visual' });
  const blank = (id: string) => onOpen({ text: blankText(id), name: `${id}.yaml`, view: 'visual', blank: true });
  const choose = (id: string) => {
    setTypeId(id);
    setStep('pick');
  };

  return (
    <div className="overlay start-overlay" onMouseDown={onClose}>
      <div className={`templates start step-${step}`} role="dialog" aria-modal="true" ref={modal} aria-label={t('Start a diagram')} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          {step === 'home' ? (
            <BrandMark size="sm" />
          ) : (
            <button className="icon-button" onClick={back} aria-label={t('Back')} title={t('Back (Esc)')}>
              <Icon name="arrow-left" />
            </button>
          )}
          <h2>
            {step === 'home'
              ? t('What do you want to draw?')
              : step === 'type'
                ? t('All templates')
                : typeId === 'all'
                  ? t('All templates and examples')
                  : t('{type}: pick a start', { type: typeName(typeId) })}
          </h2>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </header>
        {step === 'home' ? (
          <Home theme={theme} onOpen={open} onBlank={() => blank('systems')} onBrowse={() => setStep('type')} onType={choose} />
        ) : (
          <div className="atlas">
            <TypeIndex shown={step === 'pick' ? typeId : undefined} onChoose={choose} />
            <section className="atlas-main">
              {step === 'type' && <Types theme={theme} current={current} last={typeId} onBlank={() => blank('systems')} onChoose={choose} />}
              {step === 'pick' && <Pick theme={theme} typeId={typeId} onType={setTypeId} onBlank={typeId === 'all' ? undefined : () => blank(typeId)} onPick={open} />}
            </section>
          </div>
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
    void (async () => {
      for (const s of list) {
        const key = `${theme}:${s.id}`;
        if (stop) return;
        if (thumbs.has(key)) continue;
        // One starter that fails to draw gets an empty card; the ones after it are still drawn.
        const r = await render(s.text, { theme, fonts: 'none', idPrefix: `t${thumbIds++}`, load: exampleLoader(s.id) }).catch(() => undefined);
        thumbs.set(key, r?.svg ?? '');
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

/** Words typed into a search box, ranked against the types (Dutch words read as their English). */
function useTypeSearch() {
  const [query, setQuery] = useState('');
  const ranked = useMemo(() => matchTypes(uiLang() === 'nl' ? englishQuery(query) : query, types), [query]);
  return { query, setQuery, ranked, matched: ranked[0]!.score > 0 };
}

function SearchField({ query, setQuery, onKeyDown, inputRef }: { query: string; setQuery(q: string): void; onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <label className="search-field">
      <Icon name="search" size={15} />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('Describe what you want to show')}
        aria-label={t('Describe what you want to show')}
        spellCheck={false}
      />
    </label>
  );
}

const scenarioCards = SCENARIOS.flatMap((sc) => {
  const main = exampleAt(sc.example);
  return main ? [{ ...sc, main, also: sc.also.flatMap(([label, path]) => (exampleAt(path) ? [{ label, starter: exampleAt(path)! }] : [])) }] : [];
});

/**
 * The first screen: a card per drawing people come to make, each opening a ready example in the editor;
 * then a blank sheet, a search by what to show (it finds the type), and every template.
 */
function Home({ theme, onOpen, onBlank, onBrowse, onType }: { theme: 'light' | 'dark'; onOpen(s: Starter): void; onBlank(): void; onBrowse(): void; onType(id: string): void }) {
  const thumb = useThumbs(
    scenarioCards.map((c) => c.main),
    theme,
  );
  const { query, setQuery, ranked, matched } = useTypeSearch();
  const grid = useRef<HTMLDivElement>(null);
  const mains = () => [...(grid.current?.querySelectorAll<HTMLElement>('.scenario-main') ?? [])];
  useEffect(() => mains()[0]?.focus(), []);
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query) onType(ranked[0]!.type.id);
    else if (e.key === 'Escape' && query) setQuery('');
    else return;
    e.preventDefault();
  };
  const best = matched ? ranked.filter((r) => r.score >= ranked[0]!.score / 2).slice(0, 4) : [];

  return (
    <div className="home">
      <div className="scenario-grid" ref={grid} onKeyDown={(e) => moveInGrid(e, mains())}>
        {scenarioCards.map((c) => {
          const svg = thumb(c.main, { w: 300, h: 140 });
          return (
            <div key={c.example} className="scenario">
              <button className="scenario-main" onClick={() => onOpen(c.main)}>
                <span className="scenario-thumb" aria-hidden="true">
                  {svg ? <span dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="thumb-wait" />}
                </span>
                <span className="scenario-title">{say(c.title)}</span>
                <span className="scenario-text">{say(c.text)}</span>
              </button>
              {c.also.length > 0 && (
                <div className="scenario-also">
                  {c.also.map((a) => (
                    <button key={a.label} className="link" onClick={() => onOpen(a.starter)} title={a.starter.title}>
                      {say(a.label)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="home-foot">
        <button className="blank-sheet" onClick={onBlank}>
          <Icon name="file-plus" size={16} />
          <strong>{t('Blank sheet')}</strong>
          <span className="blank-what">{t('Drag shapes onto an empty page.')}</span>
        </button>
        <div className="home-search">
          <SearchField query={query} setQuery={setQuery} onKeyDown={onSearchKey} />
          <p className="type-hint" role="status">
            {!query ? (
              <>{t('Try “tables and keys” or “who has access”.')}</>
            ) : matched ? (
              <>
                {best.map(({ type: ty }, i) => (
                  <button key={ty.id} className={i === 0 ? 'link best' : 'link'} onClick={() => onType(ty.id)}>
                    {ty.name}
                  </button>
                ))}{' '}
                <kbd>↵</kbd> {t('opens the first.')}
              </>
            ) : (
              <>{t('No type matches those words. Architecture fits most systems.')}</>
            )}
          </p>
        </div>
        <button className="chip import-chip" onClick={onBrowse} title={t('Every template and example, of every type')}>
          <Icon name="layout-grid" size={13} /> {t('All templates ({count})', { count: starters.length })}
        </button>
      </div>
    </div>
  );
}

const typeCount = (id: string) => starters.filter((s) => s.type === id).length;

/** Every type, with how many templates it has; the one shown marked. */
function TypeIndex({ shown, onChoose }: { shown: string | undefined; onChoose(id: string): void }) {
  return (
    <nav className="atlas-index" aria-label={t('Diagram type')}>
      <ul>
        <li>
          <button aria-current={shown === 'all' ? 'true' : undefined} onClick={() => onChoose('all')}>
            <span className="atlas-name">{t('All templates')}</span>
            <span className="atlas-count">{starters.length}</span>
          </button>
        </li>
        {types.map((ty) => (
          <li key={ty.id}>
            <button aria-current={shown === ty.id ? 'true' : undefined} onClick={() => onChoose(ty.id)} title={ty.tagline}>
              <span className="atlas-name">{ty.name}</span>
              <span className="atlas-count">{typeCount(ty.id)}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** An empty sheet, before every template. */
function BlankSheet({ what, onBlank }: { what: string; onBlank(): void }) {
  return (
    <button className="blank-sheet" onClick={onBlank}>
      <Icon name="file-plus" size={16} />
      <strong>{t('Blank sheet')}</strong>
      <span className="blank-what">{what}</span>
    </button>
  );
}
/** "Not for" pointers to types that exist; a pointer to a type not (yet) registered stays plain text. */
const pointsTo = (use?: string) => (use && types.some((t) => t.id === use) ? use : undefined);
const typeTemplates = types.map((t) => starters.find((s) => s.id === `template:${t.id}`)).filter((s): s is Starter => !!s);

/** Every type: a card each says what it is for. */
function Types({ theme, current, last, onChoose, onBlank }: { theme: 'light' | 'dark'; current?: string; last: string; onChoose(id: string): void; onBlank(): void }) {
  const { query, setQuery, ranked, matched } = useTypeSearch();
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const thumb = useThumbs(typeTemplates, theme);
  const card = (id: string) => grid.current?.querySelector<HTMLElement>(`[data-type="${id}"]`);
  // Back from a type's templates lands on that type; the guide on the open diagram's type; else the search box.
  useEffect(() => {
    const on = last !== 'all' ? last : current;
    const back = on ? card(on)?.querySelector<HTMLElement>('.type-main') : undefined;
    back?.scrollIntoView({ block: 'nearest' });
    (back ?? search.current)?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        <SearchField query={query} setQuery={setQuery} onKeyDown={onSearchKey} inputRef={search} />
        <button className="chip import-chip" onClick={() => onChoose('all')} title={t('Every template and example, of every type')}>
          <Icon name="layout-grid" size={13} /> {t('All templates and examples')}
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
        {!query && <BlankSheet what={t('An empty architecture diagram: drag shapes onto it, or write it in YAML.')} onBlank={onBlank} />}
        {ranked.map(({ type: ty, score }, i) => {
          const s = typeTemplates.find((x) => x.type === ty.id);
          const svg = s && thumb(s, { w: 222, h: 80 });
          const cls = ['type-card', matched && i === 0 && 'best', matched && score < ranked[0]!.score / 2 && 'faded', ty.id === current && 'current'];
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
                {ty.tagline && <span className="type-tagline">{ty.tagline}</span>}
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
                <span className="type-count">{t('{count} template|{count} templates', { count: typeCount(ty.id) })}</span>
              </button>
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

/** The chosen type's template and examples (or all of them); a card opens in the editor. */
function Pick({ theme, typeId, onType, onPick, onBlank }: { theme: 'light' | 'dark'; typeId: string; onType(id: string): void; onPick(s: Starter): void; onBlank?(): void }) {
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
        {onBlank && type && <BlankSheet what={t('An empty {type}: drag shapes onto it, or write it in YAML.', { type: type.name.toLowerCase() })} onBlank={onBlank} />}
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
                {/* Within a type an example says what it shows (its subtitle); among all, its type. */}
                <span className="template-sub" title={s.kind === 'example' ? s.subtitle : undefined}>
                  {s.kind === 'template' ? t('Template') : type && s.subtitle && !twin ? s.subtitle : t('Example')}
                  {s.kind === 'template' && type ? t(': the smallest start') : !type ? ` · ${typeName(s.type)}` : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
