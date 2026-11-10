// The preview page: shows the drawing the extension sends, with pan and zoom that survive every
// update, and says back what was clicked, dragged and picked. No engine here: the extension draws.
import type { FromView, Kind, ToView, ViewConfig } from './protocol.ts';
import type { Picture } from '../draw.ts';

interface Vscode {
  postMessage(m: FromView): void;
  getState(): unknown;
  setState(s: unknown): void;
}
declare function acquireVsCodeApi(): Vscode;

interface View {
  x: number;
  y: number;
  scale: number;
}
interface Saved {
  docKey?: string;
  view?: View;
}

const vscode = acquireVsCodeApi();
const config = ((window as unknown as { cartoConfig?: ViewConfig }).cartoConfig ?? { mode: 'preview' }) as ViewConfig;
const present = config.mode === 'present';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bar = $('bar');
const stage = $('stage');
const paper = $('paper');
const stale = $('stale');
const empty = $('empty');
const viewPick = $<HTMLSelectElement>('view');
const caption = $('caption');

const saved = (vscode.getState() as Saved | undefined) ?? {};
let view: View = saved.view ?? { x: 0, y: 0, scale: 1 };
let docKey = saved.docKey;
let picture: Picture | undefined;
let pinnable = false;
let fontsKey = '';
let selected: { kind: Kind; id: string } | undefined;
let highlighted: { kind: Kind; id: string }[] = [];
const MIN = 0.05;
const MAX = 8;

const send = (m: FromView) => vscode.postMessage(m);
const remember = () => vscode.setState({ docKey, view } satisfies Saved);

function apply() {
  paper.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  remember();
}

function fit() {
  if (!picture) return;
  const r = stage.getBoundingClientRect();
  const pad = present ? 24 : 16;
  const room = { w: Math.max(40, r.width - 2 * pad), h: Math.max(40, r.height - 2 * pad - (present && !caption.hidden ? caption.offsetHeight : 0)) };
  const scale = Math.min(present ? MAX : 1.5, room.w / picture.width, room.h / picture.height);
  view = { scale, x: (r.width - picture.width * scale) / 2, y: Math.max(pad, (room.h + 2 * pad - picture.height * scale) / 2) };
  apply();
}

function zoomAt(factor: number, cx?: number, cy?: number) {
  const r = stage.getBoundingClientRect();
  const x = cx ?? r.width / 2;
  const y = cy ?? r.height / 2;
  const scale = Math.min(MAX, Math.max(MIN, view.scale * factor));
  const k = scale / view.scale;
  view = { scale, x: x - (x - view.x) * k, y: y - (y - view.y) * k };
  apply();
}

/** The toolbar can wrap: the stage starts under it. */
const placeStage = () => {
  stage.style.top = present ? '0' : `${bar.offsetHeight}px`;
};
new ResizeObserver(placeStage).observe(bar);

const selector = (kind: Kind, id: string) => `[data-${kind}="${CSS.escape(id)}"]`;

function paintHighlight() {
  for (const el of paper.querySelectorAll('.carto-hl')) el.classList.remove('carto-hl');
  for (const h of highlighted) for (const el of paper.querySelectorAll(selector(h.kind, h.id))) el.classList.add('carto-hl');
}

function showProblems(errors: number, warnings: number, message?: string, isStale = false) {
  const chip = $('problems');
  chip.hidden = !errors && !warnings;
  chip.textContent = errors ? `${errors} error${errors > 1 ? 's' : ''}` : `${warnings} warning${warnings > 1 ? 's' : ''}`;
  chip.classList.toggle('error', errors > 0);
  chip.title = message ?? '';
  stale.hidden = !isStale;
  stale.textContent = isStale ? `Out of date: ${message ?? 'the text has problems'}` : '';
}

function showControls(p: Picture) {
  // Views
  const views = p.views ?? [];
  viewPick.hidden = views.length === 0;
  viewPick.replaceChildren(
    ...views.map((v) => {
      const o = document.createElement('option');
      o.value = v.name;
      o.textContent = v.title ? `${v.title} (${v.name})` : v.name;
      o.selected = v.name === p.view;
      return o;
    }),
  );
  // Steps
  const steps = p.steps ?? [];
  $('steps').hidden = steps.length === 0;
  $('stepN').textContent = p.step ? `${p.step} / ${steps.length}` : `${steps.length} steps`;
  $('whole').hidden = !p.step;
  // Focus
  const chip = $('focusChip');
  chip.hidden = !p.focus;
  chip.textContent = p.focus ? `Focus: ${p.focus.names.join(', ')}` : '';
  $('unfocus').hidden = !p.focus;
  $('focus').hidden = !selected || selected.kind === 'edge' || !!p.focus;
  // The presenter's caption
  const step = p.step ? steps[p.step - 1] : undefined;
  caption.hidden = !present || !p.step;
  if (present) {
    (caption.querySelector('.t') as HTMLElement).textContent = step?.title ?? '';
    (caption.querySelector('.c') as HTMLElement).textContent = step?.caption ?? '';
    (caption.querySelector('.n') as HTMLElement).textContent = p.step ? `${p.step} / ${steps.length}` : '';
  }
}

function show(m: Extract<ToView, { type: 'picture' }>) {
  if (m.fontCss !== undefined && m.picture.fonts !== fontsKey) {
    fontsKey = m.picture.fonts;
    let style = document.getElementById('carto-fonts');
    if (!style) {
      style = document.createElement('style');
      style.id = 'carto-fonts';
      document.head.append(style);
    }
    style.textContent = m.fontCss;
  }
  // A page opened again (the tab was hidden) gets back where it was; a new document or view is fitted; an edit keeps where you were.
  const restoring = !picture && saved.docKey === m.docKey && !!saved.view;
  const first = !picture || m.docKey !== docKey;
  picture = m.picture;
  pinnable = m.pinnable;
  docKey = m.docKey;
  paper.innerHTML = m.picture.svg;
  paper.classList.toggle('pinnable', pinnable);
  if (m.picture.canvas) document.body.style.setProperty('--carto-canvas', m.picture.canvas);
  empty.hidden = true;
  showControls(m.picture);
  showProblems(m.errors, m.warnings, m.message, false);
  paintHighlight();
  placeStage();
  if (first && !restoring) fit();
  else apply();
}

window.addEventListener('message', (e: MessageEvent<ToView>) => {
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'picture') show(m);
  else if (m.type === 'stale') {
    if (!picture) {
      empty.hidden = false;
      empty.textContent = m.message ?? 'Nothing to draw yet';
    }
    showProblems(m.errors, m.warnings, m.message, !!picture);
  } else if (m.type === 'highlight') {
    highlighted = m.items;
    paintHighlight();
  } else if (m.type === 'rasterize') void rasterize(m);
});

/** SVG to PNG in the page's own canvas: no native code in the extension. */
async function rasterize(m: Extract<ToView, { type: 'rasterize' }>) {
  try {
    const url = URL.createObjectURL(new Blob([m.svg], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error('The browser could not read the SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(m.width));
    canvas.height = Math.max(1, Math.round(m.height));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const png = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    send({ type: 'raster', id: m.id, png });
  } catch (e) {
    send({ type: 'raster', id: m.id, error: e instanceof Error ? e.message : String(e) });
  }
}

// Toolbar
viewPick.addEventListener('change', () => send({ type: 'view', name: viewPick.value || null }));
const stepBy = (d: number) => {
  const n = picture?.steps?.length ?? 0;
  if (!n) return;
  const now = picture?.step ?? 0;
  const next = Math.min(n, Math.max(1, now + d));
  if (next !== now) send({ type: 'step', n: next });
};
$('prev').addEventListener('click', () => stepBy(-1));
$('next').addEventListener('click', () => stepBy(1));
$('whole').addEventListener('click', () => send({ type: 'step', n: null }));
$('focus').addEventListener('click', () => selected && send({ type: 'focus', id: selected.id }));
$('unfocus').addEventListener('click', () => send({ type: 'focus', id: null }));
$('fit').addEventListener('click', fit);
$('in').addEventListener('click', () => zoomAt(1.25));
$('out').addEventListener('click', () => zoomAt(0.8));
$('present').addEventListener('click', () => send({ type: 'command', name: 'present' }));
$('openEditor').addEventListener('click', () => send({ type: 'command', name: 'openEditor' }));

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('select')) return;
  if (e.key === '0') fit();
  else if (e.key === '+' || e.key === '=') zoomAt(1.25);
  else if (e.key === '-') zoomAt(0.8);
  else if (e.key === 'ArrowRight' || e.key === 'PageDown' || (present && e.key === ' ')) stepBy(1);
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') stepBy(-1);
  else if (e.key === 'Home' && picture?.steps?.length) send({ type: 'step', n: 1 });
  else if (e.key === 'End' && picture?.steps?.length) send({ type: 'step', n: picture.steps.length });
  else if (e.key === 'Escape' && present) send({ type: 'exit' });
  else if (e.key === 'f') fit();
  else return;
  e.preventDefault();
});

// Wheel: pinch or ctrl/cmd zooms around the pointer, scrolling pans.
stage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else {
      view = { ...view, x: view.x - e.deltaX, y: view.y - e.deltaY };
      apply();
    }
  },
  { passive: false },
);

interface Drag {
  pointer: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  moved: boolean;
  target?: { kind: Kind; id: string; el: SVGGraphicsElement; transform: string | null };
}
let drag: Drag | undefined;

const hitOf = (t: EventTarget | null): { kind: Kind; id: string; el: SVGGraphicsElement } | undefined => {
  const el = (t as Element | null)?.closest?.('[data-node],[data-edge],[data-group]') as SVGGraphicsElement | null;
  if (!el) return undefined;
  const kind: Kind = el.hasAttribute('data-node') ? 'node' : el.hasAttribute('data-edge') ? 'edge' : 'group';
  return { kind, id: el.getAttribute(`data-${kind}`)!, el };
};

stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  stage.focus({ preventScroll: true });
  const hit = hitOf(e.target);
  drag = { pointer: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, ...(hit ? { target: { ...hit, transform: hit.el.getAttribute('transform') } } : {}) };
  stage.setPointerCapture(e.pointerId);
});

stage.addEventListener('pointermove', (e) => {
  const d = drag;
  if (!d || d.pointer !== e.pointerId) return;
  const dx = e.clientX - d.x;
  const dy = e.clientY - d.y;
  if (!d.moved && Math.hypot(dx, dy) < 4) return;
  d.moved = true;
  const t = d.target;
  // Only a node is dragged to a pin (in present mode nothing moves); anything else pans.
  if (t && t.kind === 'node' && pinnable && !present && picture?.nodes[t.id]) {
    t.el.classList.add('carto-dragging');
    t.el.setAttribute('transform', `translate(${dx / view.scale} ${dy / view.scale})${t.transform ? ' ' + t.transform : ''}`);
    return;
  }
  stage.classList.add('panning');
  view = { ...view, x: d.vx + dx, y: d.vy + dy };
  apply();
});

const end = (e: PointerEvent) => {
  const d = drag;
  if (!d || d.pointer !== e.pointerId) return;
  drag = undefined;
  stage.classList.remove('panning');
  const t = d.target;
  if (!d.moved) {
    if (present) return;
    selected = t && { kind: t.kind, id: t.id };
    if (picture) $('focus').hidden = !selected || selected.kind === 'edge' || !!picture.focus;
    if (t) {
      highlighted = [{ kind: t.kind, id: t.id }];
      paintHighlight();
      send({ type: 'reveal', kind: t.kind, id: t.id });
    }
    return;
  }
  const box = t && t.kind === 'node' ? picture?.nodes[t.id] : undefined;
  if (t && box && pinnable && !present && picture && e.type === 'pointerup') {
    const s = picture.shift;
    const x = Math.round(box.x + s.x + (e.clientX - d.x) / view.scale);
    const y = Math.round(box.y + s.y + (e.clientY - d.y) / view.scale);
    send({ type: 'pin', kind: 'node', id: t.id, x, y });
  } else if (t) {
    t.el.classList.remove('carto-dragging');
    if (t.transform) t.el.setAttribute('transform', t.transform);
    else if (t.kind === 'node') t.el.removeAttribute('transform');
  }
};
stage.addEventListener('pointerup', end);
stage.addEventListener('pointercancel', end);
// A double-click on a node lets its pin go.
stage.addEventListener('dblclick', (e) => {
  const hit = hitOf(e.target);
  if (hit && hit.kind === 'node' && pinnable && !present) send({ type: 'unpin', kind: 'node', id: hit.id });
});

window.addEventListener('resize', () => {
  if (present) fit();
});

if (present) bar.hidden = true;
send({ type: 'ready' });
