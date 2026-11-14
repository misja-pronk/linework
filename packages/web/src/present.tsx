// Present: the drawing full screen, told step by step like a slide deck. The views of a file come in
// order with the steps of each inside it; a linked element drills down and Backspace comes back.
// Every step is the same drawing in the same place, so stepping reads as one picture building up.
import './present.css';
import { shortcutFor } from './keys.ts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { focusReach, type LayoutSidecar, type Link } from '@cartography/core';
import { render, type RenderResult } from '@cartography/engine';
import { useBrand } from './brand.ts';
import { useIconOptions } from './icon-packs.ts';
import { registerThemeFonts } from './fonts.ts';
import { Icon } from './icon.tsx';
import { linkTarget } from './links.ts';
import { presentedBy } from './export.ts';
import { useRestoreFocus } from './menu.tsx';
import type { LayersOptions } from './layers-control.tsx';
import { t } from './i18n/index.ts';

/** A diagram to present: its text and what it needs to draw like it does in the editor. */
export interface PresentDoc {
  text: string;
  /** Its path in the folder (or under examples/), so links to diagrams next to it can be followed. */
  path?: string;
  file?: string;
  sidecar?: LayoutSidecar;
  load?: (file: string) => string;
}

export interface PresentProps {
  doc: PresentDoc;
  theme: 'light' | 'dark';
  /** Where to start: the view and the step open in the editor. */
  view?: string;
  step?: number;
  /** A focus set in the editor (F, +, −, D) for that view, as render takes it: its slides keep it. */
  focus?: unknown;
  /** Layers switched on in the editor for that view: its slides keep them. */
  layers?: LayersOptions;
  /** Another diagram, for a link that leads there; nothing when it is not at hand. */
  open?(path: string): PresentDoc | undefined;
  onClose(): void;
}

interface Slide {
  view?: string;
  step?: number;
  /** The editor's focus, on the slides of the view it was set in. */
  focus?: unknown;
  /** Layers to draw it through: the editor's, or one layer per slide when the deck goes through them (L). */
  layers?: LayersOptions;
  /** A slide of its own for one layer, after the view's steps. */
  layer?: boolean;
}

interface Deck {
  id: number;
  doc: PresentDoc;
  slides: Slide[];
  /** Steps nobody wrote, made from the drawing's groups so it can still be told in parts. */
  auto?: boolean;
  /** The slide the editor shows, alone, while the deck around it is made: whether its words get room. */
  opening?: { band: boolean };
}

/**
 * A drawing without steps of its own, told group by group: a step per top-level group (in focus, the
 * rest standing back; with one around everything, also the groups in it), then the whole. Only for two to nine groups, in a diagram without views; the
 * text gets the steps a person would write, so the slides are the same as with written steps.
 */
function autoSteps(text: string, r: RenderResult): string | undefined {
  const drawn = r.graph?.groups.filter((g) => r.placed?.groups.has(g.id)) ?? [];
  // The top-level groups; one group around everything says little, so then the groups in it too.
  const top = drawn.filter((g) => !g.parent);
  const groups = top.length === 1 ? drawn.filter((g) => !g.parent || g.parent === top[0]!.id) : top;
  if (r.steps?.length || r.views?.length || groups.length < 2 || groups.length > 9 || /^steps:/m.test(text)) return undefined;
  const q = (v: string) => JSON.stringify(v);
  return `${text.replace(/\s*$/, '')}\n\nsteps:\n${groups.map((g) => `  - { title: ${q(g.label || g.id)}, focus: ${q(g.id)} }`).join('\n')}\n  - { title: ${q(t('Everything'))} }\n`;
}

interface Frame {
  id: number;
  deck: Deck;
  at: number;
  result: RenderResult;
}

interface Linked {
  kind: 'node' | 'group';
  id: string;
  link: Link;
}

/** How far a small drawing is enlarged at most: bigger than this and the text shouts. */
const MAX_SCALE = 2.5;
const IDLE_MS = 2500;
const FADE_MS = 420;
let decks = 0;

export function Present(p: PresentProps) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const { theme: themeOverride } = useBrand();
  const icons = useIconOptions();
  const [deck, setDeck] = useState<Deck>();
  const [at, setAt] = useState(0);
  /** The drawing on screen and, while it fades, the one before it. */
  const [frames, setFrames] = useState<Frame[]>([]);
  const frameId = useRef(0);
  /** Slides stepped on (or back) while the opening slide stood alone. */
  const ahead = useRef(0);
  /** What makes the deck, waiting for the opening slide to be on screen. */
  const afterOpening = useRef<() => void>(undefined);
  const cache = useRef(new Map<string, Promise<RenderResult>>());
  /** Where a followed link came from, for Backspace. */
  const [trail, setTrail] = useState<{ deck: Deck; at: number }[]>([]);
  const [blank, setBlank] = useState(false);
  const [typed, setTyped] = useState('');
  const [idle, setIdle] = useState(false);
  const [flash, setFlash] = useState<string>();
  /** The linked element that has the keyboard (Tab), as an index into the links on screen. */
  const [ring, setRing] = useState<number>();
  const [ringBox, setRingBox] = useState<{ left: number; top: number; width: number; height: number }>();
  /** A: the editor's focus set aside, everything drawn; A again brings it back. */
  const [whole, setWhole] = useState(false);
  /** L: after each view's steps, a slide per layer of it (security, data, phase 2…). */
  const [byLayer, setByLayer] = useState(false);
  useRestoreFocus();

  const keyOf = useCallback((d: Deck, i: number, slide = d.slides[i]!) => `${d.id}:${i}${slide.focus !== undefined && !whole ? ':focus' : ''}${slide.layers ? `:@${slide.layers.layers?.join('+')}` : ''}`, [whole]);
  const draw = useCallback(
    (d: Deck, i: number, slide = d.slides[i]!) => {
      const focus = slide.focus !== undefined && !whole ? { focus: slide.focus } : {};
      const key = keyOf(d, i, slide);
      let hit = cache.current.get(key);
      if (!hit) {
        hit = render(d.doc.text, { theme: p.theme, themeOverride, ...icons, sidecar: d.doc.sidecar, load: d.doc.load, file: d.doc.file, view: slide.view, step: slide.step, stepCaption: false, fonts: 'none', marks: true, idPrefix: `present-${d.id}-${i}`, ...focus, ...slide.layers }).then(async (r) => {
          // A linked diagram can have a theme of its own: the page needs its faces before the slide shows.
          await registerThemeFonts(r.theme);
          return r;
        });
        cache.current.set(key, hit);
      }
      return hit;
    },
    [p.theme, themeOverride, icons, whole, keyOf],
  );

  /**
   * The slides of a diagram: its views in order (as written first), a slide per step where a view has
   * steps. A view read scrolling (a whole sequence) is one slide before the views that present it.
   */
  const outline = useCallback(
    async (doc: PresentDoc, layered = false): Promise<Deck | undefined> => {
      const d: Deck = { id: ++decks, doc, slides: [] };
      const whole = (view?: string) => render(d.doc.text, { theme: p.theme, themeOverride, ...icons, sidecar: d.doc.sidecar, load: d.doc.load, file: d.doc.file, view, fonts: 'none' });
      let first = await whole();
      const told = first.svg ? autoSteps(doc.text, first) : undefined;
      if (told) {
        d.doc = { ...doc, text: told };
        d.auto = true;
        const r = await whole();
        // Steps that do not draw (a type that takes none): the drawing as it is, one slide.
        if (r.svg && r.steps?.length) first = r;
        else (d.doc = doc), (d.auto = false);
      }
      const views = first.views?.length ? [...(first.onlyViews || first.canvas ? [] : [undefined]), ...first.views.map((v) => v.name)] : [undefined];
      for (const view of views) {
        const r = view === first.view ? first : await whole(view);
        if (!r.svg) continue;
        // A view the type draws itself can be the drawing as written (data products: the one in `view:`): one slide for both.
        if (view !== undefined && r.svg === first.svg && d.slides[0]?.view === undefined) d.slides = d.slides.filter((s) => s.view !== undefined);
        // A drawing read scrolling (a whole sequence) is presented by its other views (its phases), which
        // tell its steps: it is one slide, the overview, unless someone wrote steps for it.
        const overview = r.stepsImplied && presentedBy(r).length > 0;
        const n = overview ? 0 : (r.steps?.length ?? 0);
        for (let step = 1; step <= Math.max(1, n); step++) d.slides.push({ view, ...(n ? { step } : {}) });
        if (layered) for (const l of (r.layers?.list ?? []).filter((x) => x.count > 0)) d.slides.push({ view, layers: { layers: [l.name] }, layer: true });
      }
      return d.slides.length ? d : undefined;
    },
    [p.theme, themeOverride, icons],
  );

  const say = useCallback((message: string) => setFlash(message), []);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(undefined), 3200);
    return () => clearTimeout(t);
  }, [flash]);

  // The deck of the open diagram, starting where the editor is. The slide the editor shows comes first,
  // alone, so presenting starts at once; the deck around it (every view drawn) follows and takes over
  // that same drawing, so nothing on screen changes.
  useEffect(() => {
    let live = true;
    const own = (s: Slide) => ({ ...(p.focus !== undefined ? { focus: p.focus } : {}), ...(p.layers && !s.layer ? { layers: p.layers } : {}) });
    const opening: Deck = { id: ++decks, doc: p.doc, slides: [{ view: p.view, step: p.step ?? 1 }], opening: { band: false } };
    Object.assign(opening.slides[0]!, own(opening.slides[0]!));
    let first: Slide | undefined;
    const rest = () => void outline(p.doc).then(made);
    void draw(opening, 0).then((r) => {
      if (!live) return;
      if (!r.svg) return rest();
      // Not the deck's first slide: a sequence whose phases tell it starts on its overview, a drawing
      // without steps is told group by group. Those wait for the deck.
      const overview = r.stepsImplied && presentedBy(r).length > 0;
      if (overview || (!r.steps?.length && !r.views?.length && autoSteps(p.doc.text, r))) return rest();
      first = { ...opening.slides[0]!, step: r.step };
      opening.slides[0] = first;
      opening.opening = { band: !!r.steps?.length || /^\s*steps:/m.test(p.doc.text) };
      afterOpening.current = rest;
      setDeck(opening);
      setAt(0);
    });
    const made = (d: Deck | undefined) => {
      if (!live) return;
      if (!d) return say(t('Nothing to present yet: fix the problems in the editor first'));
      for (const s of d.slides) if (s.view === p.view) Object.assign(s, own(s));
      const start = d.slides.findIndex((s) => s.view === p.view && (s.step ?? 1) === (p.step ?? 1));
      const at = Math.max(0, start >= 0 ? start : d.slides.findIndex((s) => s.view === p.view));
      // The opening slide is this one: the deck takes its drawing as it is.
      const same = d.slides[at];
      if (first && same && !d.auto && same.view === first.view && same.step === first.step) cache.current.set(keyOf(d, at), cache.current.get(keyOf(opening, 0))!);
      setDeck(d);
      setAt(Math.min(d.slides.length - 1, Math.max(0, at + ahead.current)));
      ahead.current = 0;
    };
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when presenting starts: edits do not reach a running presentation
  }, []);

  // The slide: drawn, shown over the one before it, and the next one made ready.
  useEffect(() => {
    if (!deck) return;
    let live = true;
    void draw(deck, at).then((result) => {
      if (!live) return;
      if (!result.svg) return say(t('This step cannot be drawn: fix the problems in the editor'));
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      // The same drawing again (the deck taking over the opening slide): it stays as it is, no fade.
      setFrames((f) => (f.at(-1)?.result === result ? [...f.slice(0, -1), { ...f.at(-1)!, deck, at }] : [...(calm ? [] : f.slice(-1)), { id: ++frameId.current, deck, at, result }]));
      setRing(undefined);
      // The deck is made once the opening slide is on screen, so making it does not hold that up.
      const rest = deck.opening && afterOpening.current;
      if (rest) (afterOpening.current = undefined), requestAnimationFrame(() => setTimeout(rest));
      if (at + 1 < deck.slides.length) void draw(deck, at + 1);
    });
    return () => {
      live = false;
    };
  }, [deck, at, draw, say]);
  useEffect(() => {
    if (frames.length < 2) return;
    const t = setTimeout(() => setFrames((f) => f.slice(-1)), FADE_MS);
    return () => clearTimeout(t);
  }, [frames]);

  const top = frames.at(-1);
  /** How many slides, once the deck is made (0 while the opening slide stands alone). */
  const count = top?.deck.opening ? 0 : (top?.deck.slides.length ?? 0);
  const state = top?.result.step ? top.result.steps?.[top.result.step - 1] : undefined;
  // A layer's slide says which layer it is, and what its caption says.
  const shownLayers = top?.deck.slides[top.at]?.layer ? top.result.layers : undefined;
  const layer = shownLayers?.list.find((l) => l.name === shownLayers.active[0]);
  const title = state?.title ?? (layer ? t('{name} layer', { name: layer.title ?? layer.name }) : undefined);
  const caption = state?.caption ?? layer?.caption;
  // Room for the words under the drawing wherever the deck has steps, so the drawing keeps its place; a view says its title itself.
  const band = !!top && (top.deck.opening ? top.deck.opening.band : top.deck.slides.some((s) => s.step || s.layer));

  /** What can be followed on this slide: linked elements that are drawn at this step. */
  const linked = (): Linked[] => {
    const g = top?.result.graph;
    if (!g) return [];
    return [
      ...g.groups.filter((x) => x.links?.length && state?.groups[x.id] !== 'hidden').map((x) => ({ kind: 'group' as const, id: x.id, link: x.links![0]! })),
      ...g.nodes.filter((x) => x.links?.length && state?.nodes[x.id] !== 'hidden').map((x) => ({ kind: 'node' as const, id: x.id, link: x.links![0]! })),
    ];
  };
  const elementOf = (l: Linked) => stage.current?.querySelector<SVGGElement>(`.present-frame:last-child [data-${l.kind}="${CSS.escape(l.id)}"]`);

  useLayoutEffect(() => {
    const el = ring == null ? undefined : linked()[ring];
    const box = el && elementOf(el)?.getBoundingClientRect();
    const frame = root.current?.getBoundingClientRect();
    setRingBox(box && frame ? { left: box.left - frame.left - 5, top: box.top - frame.top - 5, width: box.width + 10, height: box.height + 10 } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- linked() is of top and its step
  }, [ring, top]);

  const go = (to: number) => {
    if (!deck) return;
    // Before the deck is made, a step on is kept for it.
    if (deck.opening) return void (ahead.current += to - at);
    setAt(Math.min(deck.slides.length - 1, Math.max(0, to)));
  };

  const follow = (link: Link) => {
    if (!deck) return;
    const to = linkTarget(link, deck.doc.path);
    if (to.kind === 'url') return void window.open(to.url, '_blank', 'noopener');
    if (to.kind === 'none') return say(to.why);
    if (to.kind === 'view') {
      const i = deck.slides.findIndex((s) => s.view === to.view);
      if (i < 0) return say(t('There is no view {view} here', { view: to.view }));
      setTrail((b) => [...b, { deck, at }]);
      return setAt(i);
    }
    const next = p.open?.(to.path);
    if (!next) return say(t('{path} is not at hand: open its folder to follow this link', { path: to.path }));
    void outline(next).then((d) => {
      if (!d) return say(t('{path} cannot be drawn', { path: to.path }));
      setTrail((b) => [...b, { deck, at }]);
      setDeck(d);
      setAt(Math.max(0, to.view ? d.slides.findIndex((s) => s.view === to.view) : 0));
    });
  };
  /** L: the deck with a slide per layer after each view's steps, or without them again; the slide on screen stays. */
  const throughLayers = () => {
    if (!deck) return;
    const now = deck.slides[at];
    const next = !byLayer;
    void outline(deck.doc, next).then((d) => {
      if (!d) return;
      if (!d.slides.some((s) => s.layer) && next) return say(t('This diagram has no layers: (tags and a layers: block, see docs/layers.md)'));
      for (const s of d.slides) {
        const old = deck.slides.find((o) => o.view === s.view && o.step === s.step && !o.layer);
        if (old && !s.layer) Object.assign(s, { focus: old.focus, layers: old.layers });
      }
      setByLayer(next);
      setDeck(d);
      const i = d.slides.findIndex((s) => s.view === now?.view && s.step === now?.step && !!s.layer === !!now?.layer && (!s.layer || s.layers?.layers?.[0] === now?.layers?.layers?.[0]));
      setAt(Math.max(0, i >= 0 ? i : d.slides.findIndex((s) => s.view === now?.view)));
      say(next ? t('A slide per layer after each view') : t('Layers left out of the deck'));
    });
  };
  const back = () => {
    const last = trail.at(-1);
    if (!last) return go(at - 1);
    setTrail((b) => b.slice(0, -1));
    setDeck(last.deck);
    setAt(last.at);
  };

  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    p.onClose();
  };

  // Keys, before anything else in the editor sees them.
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const links = linked();
    if (blank) setBlank(false);
    else if (/^\d$/.test(e.key)) setTyped((t) => (t + e.key).slice(0, 4));
    else if (e.key === 'Enter' && typed) (go(Number(typed) - 1), setTyped(''));
    else if (e.key === 'Escape' && (typed || ring != null)) (setTyped(''), setRing(undefined));
    else if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && ring != null && links[ring]) follow(links[ring].link);
    else {
      // The rest by the table in keys.ts, which the "?" sheet shows.
      const id = shortcutFor(e, ['present']);
      if (id === 'present-links') {
        if (!links.length) say(t('Nothing on this slide leads further'));
        else setRing((r) => (r == null ? (e.shiftKey ? links.length - 1 : 0) : (r + (e.shiftKey ? links.length - 1 : 1)) % links.length));
      } else if (id === 'present-back') back();
      else if (id === 'present-next') go(at + 1);
      else if (id === 'present-previous') go(at - 1);
      else if (id === 'present-ends') go(e.key === 'Home' ? 0 : count - 1);
      else if (id === 'present-blank') setBlank(true);
      else if (id === 'present-whole' && focusable) setWhole((w) => !w);
      else if (id === 'present-layers') throughLayers();
      else if (id === 'present-full') {
        windowed.current = !!document.fullscreenElement;
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void root.current?.requestFullscreen?.().catch(() => {});
      } else return;
    }
    if (e.key !== 'Enter' && !/^\d$/.test(e.key)) setTyped('');
    e.preventDefault();
  };
  const keys = useRef(onKey);
  keys.current = onKey;
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, []);

  // Full screen where the browser allows it; leaving full screen (Esc there never reaches the page) ends the presentation.
  const closing = useRef(p.onClose);
  closing.current = p.onClose;
  /** F left full screen on purpose: the presentation goes on in the window. */
  const windowed = useRef(false);
  useEffect(() => {
    const el = root.current;
    el?.focus();
    let full = false;
    const on = () => {
      if (document.fullscreenElement === el) full = true;
      else if (full && !windowed.current) closing.current();
      else full = false;
    };
    document.addEventListener('fullscreenchange', on);
    // Only with the key or click that opened it still fresh: asking a second time (a development build
    // runs this twice, the first ask used the click up) only puts a warning in the console.
    if (!document.fullscreenElement && navigator.userActivation?.isActive !== false) void el?.requestFullscreen?.().catch(() => {});
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // The pointer and the controls go away when the mouse rests.
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stir = useCallback(() => {
    setIdle(false);
    clearTimeout(rest.current);
    rest.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    stir();
    return () => clearTimeout(rest.current);
  }, [stir]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as Element).closest('a');
    if (a) e.preventDefault();
    if (blank) return setBlank(false);
    const hit = a?.querySelector<SVGGElement>('[data-node],[data-group]');
    const l = hit && (e.metaKey || e.ctrlKey) ? linked().find((x) => (x.kind === 'node' ? hit.dataset.node === x.id : hit.dataset.group === x.id)) : undefined;
    if (l) follow(l.link);
    else go(at + 1);
  };

  const th = top?.result.theme;
  const colours = th ? ({ '--present-canvas': th.canvas, '--present-text': th.text, '--present-muted': th.textMuted, '--present-faint': th.textFaint, '--present-line': th.border, '--present-accent': th.accent ?? th.tones.blue.fg } as React.CSSProperties) : undefined;
  const linkCount = linked().length;
  /** Why there is nowhere to go: one slide, and how to make more. */
  const oneSlide = t('One slide: this drawing has no steps. Add some in the editor (S on a selection, or steps: in the YAML) to tell it in parts');
  /** This slide has the editor's focus: drawn, or set aside with A. */
  const focusable = top?.deck.slides[top.at]?.focus != null;
  const lens = focusable ? top?.result.focus : undefined;

  return (
    <div ref={root} className={`present${idle ? ' idle' : ''}${top && !band ? ' no-band' : ''}`} style={colours} tabIndex={-1} role="dialog" aria-label={t('Presentation')} aria-modal="true" onMouseMove={stir} onClick={onClick}>
      <div className="present-stage" ref={stage}>
        {frames.map((f, i) => (
          <div key={f.id} className={`present-frame${i < frames.length - 1 ? ' leaving' : ''}`} aria-hidden={i < frames.length - 1}>
            <div style={{ maxWidth: (f.result.width ?? 0) * MAX_SCALE, maxHeight: (f.result.height ?? 0) * MAX_SCALE }} dangerouslySetInnerHTML={{ __html: f.result.svg ?? '' }} />
          </div>
        ))}
      </div>
      {top && band && (
        <div className="present-caption">
          <div className="present-words" key={top.id}>
            {title && <strong>{title}</strong>}
            {caption && <p>{caption}</p>}
          </div>
        </div>
      )}
      {top && count > 1 && (
        <>
          <div className="present-count" aria-hidden="true">
            {top.at + 1} / {count}
          </div>
          <div className="present-progress" aria-hidden="true">
            <i style={{ width: `${((top.at + 1) / count) * 100}%` }} />
          </div>
        </>
      )}
      {ringBox && <div className="present-ring" style={ringBox} />}
      {focusable && (lens || whole) && (
        <div className="present-focus" onClick={(e) => e.stopPropagation()}>
          <Icon name="focus" size={14} />
          {lens && !whole ? (
            <span>
              {t('Focused on')} <strong>{lens.names.join(', ') || lens.on.join(', ')}</strong> · {focusReach(lens)}
            </span>
          ) : (
            <span>{t('Everything shown')}</span>
          )}
          <button onClick={() => setWhole((w) => !w)} title={whole ? t('Back to the focus set in the editor (A)') : t('Show everything (A)')}>
            {whole ? t('Focus') : t('All')} <kbd>A</kbd>
          </button>
        </div>
      )}
      <div className="present-tools" onClick={(e) => e.stopPropagation()}>
        {trail.length > 0 && (
          <button onClick={back} title={t('Back to where the link was followed (⌫)')}>
            <Icon name="arrow-left" size={15} /> {t('Back')} <kbd>⌫</kbd>
          </button>
        )}
        <button onClick={() => go(at - 1)} disabled={at === 0} title={count <= 1 ? oneSlide : at === 0 ? t('This is the first slide') : t('Previous (←)')} aria-label={t('Previous')}>
          <kbd>←</kbd>
        </button>
        <button onClick={() => go(at + 1)} disabled={at >= count - 1} title={count <= 1 ? oneSlide : at >= count - 1 ? t('This is the last slide') : t('Next (→ or Space)')} aria-label={t('Next')}>
          <kbd>→</kbd>
        </button>
        <button onClick={close} title={t('Stop presenting (Esc)')}>
          <Icon name="x" size={15} /> {t('Exit')} <kbd>Esc</kbd>
        </button>
      </div>
      {top && !top.deck.opening && (count <= 1 || top.deck.auto) && (
        <div className="present-about" onClick={(e) => e.stopPropagation()}>
          {count <= 1 ? t('One slide: add steps in the editor (S on a selection) to tell this drawing in parts') : t('Told group by group: write steps: (S in the editor) to tell it your way')}
        </div>
      )}
      <div className="present-help" aria-hidden="true">
        <kbd>→</kbd> <kbd>Space</kbd> {t('next@hint')} · <kbd>←</kbd> {t('back@hint')} · {t('number@hint')} + <kbd>↵</kbd> {t('jump@hint')} · <kbd>L</kbd> {byLayer ? t('no layer slides') : t('through the layers')} · <kbd>B</kbd> {t('blank@hint')}
        {focusable && (
          <>
            {' · '}
            <kbd>A</kbd> {whole ? t('focus@hint') : t('everything@hint')}
          </>
        )}
        {linkCount > 0 && (
          <>
            {' · '}
            <kbd>Tab</kbd> <kbd>↵</kbd> {t('or ⌘-click opens a link')}
          </>
        )}
        {' · '}
        <kbd>Esc</kbd> {t('exit@hint')}
      </div>
      {typed && (
        <div className="present-note" role="status">
          {t('Go to {n}', { n: typed })} <kbd>↵</kbd>
        </div>
      )}
      {flash && !typed && (
        <div className="present-note" role="status">
          {flash}
        </div>
      )}
      {blank && <div className="present-blank" />}
      <div className="sr-only" role="status" aria-live="polite">
        {top ? `${count > 1 ? `${t('{n} of {count}', { n: top.at + 1, count })}. ` : ''}${[title, caption].filter(Boolean).join('. ')}` : ''}
      </div>
    </div>
  );
}
