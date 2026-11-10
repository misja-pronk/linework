// Present: the drawing full screen, told step by step like a slide deck. The views of a file come in
// order with the steps of each inside it; a linked element drills down and Backspace comes back.
// Every step is the same drawing in the same place, so stepping reads as one picture building up.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { focusReach, type LayoutSidecar, type Link } from '@cartography/core';
import { render, type RenderResult } from '@cartography/engine';
import { useBrand } from './brand.ts';
import { registerThemeFonts } from './fonts.ts';
import { Icon } from './icon.tsx';
import { linkTarget } from './links.ts';
import { useRestoreFocus } from './menu.tsx';

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
  /** Another diagram, for a link that leads there; nothing when it is not at hand. */
  open?(path: string): PresentDoc | undefined;
  onClose(): void;
}

interface Slide {
  view?: string;
  step?: number;
  /** The editor's focus, on the slides of the view it was set in. */
  focus?: unknown;
}

interface Deck {
  id: number;
  doc: PresentDoc;
  slides: Slide[];
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
  const { theme: themeOverride, icons } = useBrand();
  const [deck, setDeck] = useState<Deck>();
  const [at, setAt] = useState(0);
  /** The drawing on screen and, while it fades, the one before it. */
  const [frames, setFrames] = useState<Frame[]>([]);
  const frameId = useRef(0);
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
  useRestoreFocus();

  const draw = useCallback(
    (d: Deck, i: number, slide = d.slides[i]!) => {
      const focus = slide.focus !== undefined && !whole ? { focus: slide.focus } : {};
      const key = `${d.id}:${i}${focus.focus ? ':focus' : ''}`;
      let hit = cache.current.get(key);
      if (!hit) {
        hit = render(d.doc.text, { theme: p.theme, themeOverride, icons, sidecar: d.doc.sidecar, load: d.doc.load, file: d.doc.file, view: slide.view, step: slide.step, stepCaption: false, fonts: 'none', marks: true, idPrefix: `present-${d.id}-${i}`, ...focus }).then(async (r) => {
          // A linked diagram can have a theme of its own: the page needs its faces before the slide shows.
          await registerThemeFonts(r.theme);
          return r;
        });
        cache.current.set(key, hit);
      }
      return hit;
    },
    [p.theme, themeOverride, icons, whole],
  );

  /** The slides of a diagram: its views in order (as written first), a slide per step where a view has steps. */
  const outline = useCallback(
    async (doc: PresentDoc): Promise<Deck | undefined> => {
      const d: Deck = { id: ++decks, doc, slides: [] };
      const whole = (view?: string) => render(doc.text, { theme: p.theme, themeOverride, icons, sidecar: doc.sidecar, load: doc.load, file: doc.file, view, fonts: 'none' });
      const first = await whole();
      // A type's own views (data products overview and detailed) are all there is: as written is one of them.
      const views = first.views?.length ? [...(first.onlyViews || first.type?.views ? [] : [undefined]), ...first.views.map((v) => v.name)] : [undefined];
      for (const view of views) {
        const r = view === first.view ? first : await whole(view);
        if (!r.svg) continue;
        const n = r.steps?.length ?? 0;
        for (let step = 1; step <= Math.max(1, n); step++) d.slides.push({ view, ...(n ? { step } : {}) });
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

  // The deck of the open diagram, starting where the editor is.
  useEffect(() => {
    let live = true;
    void outline(p.doc).then((d) => {
      if (!live) return;
      if (!d) return say('Nothing to present yet: fix the problems in the editor first');
      if (p.focus !== undefined) for (const s of d.slides) if (s.view === p.view) s.focus = p.focus;
      const start = d.slides.findIndex((s) => s.view === p.view && (s.step ?? 1) === (p.step ?? 1));
      setDeck(d);
      setAt(Math.max(0, start >= 0 ? start : d.slides.findIndex((s) => s.view === p.view)));
    });
    return () => {
      live = false;
    };
    // Only when presenting starts: edits do not reach a running presentation.
  }, []);

  // The slide: drawn, shown over the one before it, and the next one made ready.
  useEffect(() => {
    if (!deck) return;
    let live = true;
    void draw(deck, at).then((result) => {
      if (!live) return;
      if (!result.svg) return say('This step cannot be drawn: fix the problems in the editor');
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      setFrames((f) => [...(calm ? [] : f.slice(-1)), { id: ++frameId.current, deck, at, result }]);
      setRing(undefined);
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
  const count = top?.deck.slides.length ?? 0;
  const state = top?.result.step ? top.result.steps?.[top.result.step - 1] : undefined;
  const title = state?.title;
  const caption = state?.caption;
  // Room for the words under the drawing wherever the deck has steps, so the drawing keeps its place; a view says its title itself.
  const band = !!top && top.deck.slides.some((s) => s.step);

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
  }, [ring, top]);

  const go = (to: number) => {
    if (!deck) return;
    setAt(Math.min(deck.slides.length - 1, Math.max(0, to)));
  };

  const follow = (link: Link) => {
    if (!deck) return;
    const t = linkTarget(link, deck.doc.path);
    if (t.kind === 'url') return void window.open(t.url, '_blank', 'noopener');
    if (t.kind === 'none') return say(t.why);
    if (t.kind === 'view') {
      const i = deck.slides.findIndex((s) => s.view === t.view);
      if (i < 0) return say(`There is no view ${t.view} here`);
      setTrail((b) => [...b, { deck, at }]);
      return setAt(i);
    }
    const next = p.open?.(t.path);
    if (!next) return say(`${t.path} is not at hand: open its folder to follow this link`);
    void outline(next).then((d) => {
      if (!d) return say(`${t.path} cannot be drawn`);
      setTrail((b) => [...b, { deck, at }]);
      setDeck(d);
      setAt(Math.max(0, t.view ? d.slides.findIndex((s) => s.view === t.view) : 0));
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
    else if (e.key === 'Tab') {
      if (!links.length) say('Nothing on this slide leads further');
      else setRing((r) => (r == null ? (e.shiftKey ? links.length - 1 : 0) : (r + (e.shiftKey ? links.length - 1 : 1)) % links.length));
    } else if (e.key === 'Backspace') back();
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'Enter' || (e.key === ' ' && !e.shiftKey)) go(at + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === ' ') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(count - 1);
    else if (e.key === '.' || e.key.toLowerCase() === 'b') setBlank(true);
    else if (e.key.toLowerCase() === 'a' && focusable) setWhole((w) => !w);
    else if (e.key.toLowerCase() === 'f') {
      windowed.current = !!document.fullscreenElement;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void root.current?.requestFullscreen?.().catch(() => {});
    }
    else return;
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
    void el?.requestFullscreen?.().catch(() => {});
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

  const t = top?.result.theme;
  const colours = t ? ({ '--present-canvas': t.canvas, '--present-text': t.text, '--present-muted': t.textMuted, '--present-faint': t.textFaint, '--present-line': t.border, '--present-accent': t.accent ?? t.tones.blue.fg } as React.CSSProperties) : undefined;
  const linkCount = linked().length;
  /** This slide has the editor's focus: drawn, or set aside with A. */
  const focusable = top?.deck.slides[top.at]?.focus != null;
  const lens = focusable ? top?.result.focus : undefined;

  return (
    <div ref={root} className={`present${idle ? ' idle' : ''}`} style={colours} tabIndex={-1} role="dialog" aria-label="Presentation" aria-modal="true" onMouseMove={stir} onClick={onClick}>
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
              Focused on <strong>{lens.names.join(', ') || lens.on.join(', ')}</strong> · {focusReach(lens)}
            </span>
          ) : (
            <span>Everything shown</span>
          )}
          <button onClick={() => setWhole((w) => !w)} title={whole ? 'Back to the focus set in the editor (A)' : 'Show everything (A)'}>
            {whole ? 'Focus' : 'All'} <kbd>A</kbd>
          </button>
        </div>
      )}
      <div className="present-tools" onClick={(e) => e.stopPropagation()}>
        {trail.length > 0 && (
          <button onClick={back} title="Back to where the link was followed (⌫)">
            <Icon name="arrow-left" size={15} /> Back <kbd>⌫</kbd>
          </button>
        )}
        <button onClick={() => go(at - 1)} disabled={at === 0} title="Previous (←)" aria-label="Previous">
          <kbd>←</kbd>
        </button>
        <button onClick={() => go(at + 1)} disabled={at >= count - 1} title="Next (→ or Space)" aria-label="Next">
          <kbd>→</kbd>
        </button>
        <button onClick={close} title="Stop presenting (Esc)">
          <Icon name="x" size={15} /> Exit <kbd>Esc</kbd>
        </button>
      </div>
      <div className="present-help" aria-hidden="true">
        <kbd>→</kbd> <kbd>Space</kbd> next · <kbd>←</kbd> back · number + <kbd>↵</kbd> jump · <kbd>B</kbd> blank
        {focusable && (
          <>
            {' · '}
            <kbd>A</kbd> {whole ? 'focus' : 'everything'}
          </>
        )}
        {linkCount > 0 && (
          <>
            {' · '}
            <kbd>Tab</kbd> <kbd>↵</kbd> or ⌘-click opens a link
          </>
        )}
        {' · '}
        <kbd>Esc</kbd> exit
      </div>
      {typed && (
        <div className="present-note" role="status">
          Go to {typed} <kbd>↵</kbd>
        </div>
      )}
      {flash && !typed && (
        <div className="present-note" role="status">
          {flash}
        </div>
      )}
      {blank && <div className="present-blank" />}
      <div className="sr-only" role="status" aria-live="polite">
        {top ? `${count > 1 ? `${top.at + 1} of ${count}. ` : ''}${[title, caption].filter(Boolean).join('. ')}` : ''}
      </div>
    </div>
  );
}
