// Export → Animation (GIF / MP4): a few choices and one button. The choices are remembered; Enter
// exports, Escape closes, and every choice is one click (or arrow keys within a group).
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './icon.tsx';
import { useRestoreFocus } from './menu.tsx';
import { store } from './store.ts';
import type { ExportInput } from './export.ts';
import type { AnimationChoice, AnimationFormat } from './animate.ts';
import './animate.css';

const DEFAULT: AnimationChoice & { theme?: 'light' | 'dark' } = { format: 'gif', width: 1280, hold: 2.5, transitions: true, drawLines: false, story: 'steps' };
const HOLDS = [1.5, 2.5, 4, 6];

function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]; onChange(v: T): void }) {
  // Arrow keys move within the group, as in any radio group.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const open = options.filter((o) => !o.disabled);
    const i = open.findIndex((o) => o.value === value);
    const next = open[(i + (e.key === 'ArrowRight' ? 1 : open.length - 1)) % open.length];
    if (next) (e.preventDefault(), onChange(next.value));
  };
  return (
    <div className="animate-row">
      <span className="animate-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={onKey}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'active' : ''} disabled={o.disabled} title={o.title} tabIndex={value === o.value ? 0 : -1} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AnimateDialog({ input, name, theme, onClose, onDone }: { input: () => ExportInput; name: string; theme: 'light' | 'dark'; onClose(): void; onDone(message: string, tone?: 'error'): void }) {
  useRestoreFocus();
  const [choice, setChoice] = useState(() => ({ ...DEFAULT, ...store.get<Partial<typeof DEFAULT>>('animation'), theme }));
  const [stories, setStories] = useState<{ steps: number; layers: number }>();
  const [video, setVideo] = useState<Record<'mp4' | 'webm', boolean>>();
  const [busy, setBusy] = useState<{ what: string; done: number }>();
  const set = (patch: Partial<typeof choice>) =>
    setChoice((c) => {
      const next = { ...c, ...patch };
      // The theme follows the editor's each time; the rest is remembered.
      store.set('animation', { ...next, theme: undefined });
      return next;
    });

  useEffect(() => {
    void import('./animate.ts').then(async (m) => {
      const [s, v] = await Promise.all([m.storiesOf(input()), m.videoFormats()]);
      setStories(s);
      setVideo(v);
    });
    // Asked once, for the drawing as it is when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** What there is decides when only one of the two is there. */
  const storyFor = (s = stories) => (s && !s.steps && s.layers ? 'layers' : s && !s.layers ? 'steps' : choice.story);
  const story = storyFor();
  const format: AnimationFormat = video && choice.format !== 'gif' && !video[choice.format] ? 'gif' : choice.format;
  const nothing = stories && !stories.steps && !stories.layers;

  const go = async () => {
    if (busy || nothing) return;
    setBusy({ what: 'Starting', done: 0 });
    try {
      const m = await import('./animate.ts');
      const told = storyFor(stories ?? (await m.storiesOf(input())));
      const blob = await m.exportAnimation({ ...input(), theme: choice.theme ?? theme }, { ...choice, story: told, format }, (what, done) => setBusy({ what, done }));
      const { download } = await import('./export.ts');
      download(`${name}${told === 'layers' ? '-layers' : ''}.${format}`, blob);
      onDone(`Saved ${format.toUpperCase()}: ${blob.size >= 1e6 ? `${(blob.size / 1e6).toFixed(1)} MB` : `${Math.round(blob.size / 1000)} kB`}`);
      onClose();
    } catch (e) {
      onDone(`Animation failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
      setBusy(undefined);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
      // Enter exports from anywhere in the dialog; a choice is made with a click, the arrow keys or Space.
      else if (e.key === 'Enter') (e.preventDefault(), void go());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="overlay" onMouseDown={() => !busy && onClose()}>
      <div className="shortcuts animate-dialog" role="dialog" aria-label="Animation" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>
            <Icon name="circle-play" /> Animation
          </h2>
          <button className="icon-button" onClick={onClose} aria-label="Close" disabled={!!busy}>
            <Icon name="x" />
          </button>
        </header>
        <p className="animate-lead">
          {nothing
            ? 'This diagram has no steps or layers to animate. Add steps: to tell it in parts (docs/animate.md).'
            : 'Every step held, a short blend to the next, the caption under the drawing. Made in this browser; nothing is uploaded.'}
        </p>
        <div className="animate-form">
          <Choice<AnimationFormat>
            label="Format"
            value={format}
            onChange={(v) => set({ format: v })}
            options={[
              { value: 'gif', label: 'GIF' },
              { value: 'mp4', label: 'MP4', disabled: video && !video.mp4, title: video && !video.mp4 ? 'This browser cannot encode H.264' : 'H.264 video' },
              { value: 'webm', label: 'WebM', disabled: video && !video.webm, title: video && !video.webm ? 'This browser cannot encode VP9' : 'VP9 video' },
            ]}
          />
          {stories && stories.steps > 0 && stories.layers > 0 && (
            <Choice<'steps' | 'layers'>
              label="Tell"
              value={story}
              onChange={(v) => set({ story: v })}
              options={[
                { value: 'steps', label: `Steps (${stories.steps})` },
                { value: 'layers', label: `Layers (${stories.layers})` },
              ]}
            />
          )}
          <Choice<number> label="Size" value={choice.width} onChange={(v) => set({ width: v })} options={[{ value: 1280, label: '1280 × 720' }, { value: 1920, label: '1920 × 1080' }]} />
          <Choice<number> label="Each step" value={HOLDS.includes(choice.hold) ? choice.hold : 2.5} onChange={(v) => set({ hold: v })} options={HOLDS.map((h) => ({ value: h, label: `${h} s` }))} />
          <Choice<'light' | 'dark'> label="Theme" value={choice.theme ?? theme} onChange={(v) => set({ theme: v })} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          <div className="animate-row">
            <span className="animate-label">Between steps</span>
            <div className="animate-checks">
              <label>
                <input type="checkbox" checked={choice.transitions} onChange={(e) => set({ transitions: e.target.checked })} /> Fade
              </label>
              <label title="New lines are drawn from where they start to where they end">
                <input type="checkbox" checked={choice.drawLines} onChange={(e) => set({ drawLines: e.target.checked })} /> Draw new lines
              </label>
            </div>
          </div>
        </div>
        <footer className="animate-footer">
          {busy ? (
            <div className="animate-progress" role="status" aria-live="polite">
              <span>{busy.what}…</span>
              <progress max={1} value={busy.done} />
            </div>
          ) : (
            <span className="animate-hint">
              <kbd>Enter</kbd> export · <kbd>Esc</kbd> close
            </span>
          )}
          <button className="button primary" onClick={() => void go()} disabled={!!busy || nothing} autoFocus>
            <Icon name="download" /> Export {format.toUpperCase()}
          </button>
        </footer>
      </div>
    </div>
  );
}
