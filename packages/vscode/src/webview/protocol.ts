// What the extension and its webview say to each other. Plain data both ways.
import type { Picture } from '../draw.ts';

export type Kind = 'node' | 'group' | 'edge';

export type ToView =
  | {
      type: 'picture';
      picture: Picture;
      /** The font faces, when they differ from the last ones sent. */
      fontCss?: string;
      /** Changes when another document or view is shown: zoom and pan start over (fit) then. */
      docKey: string;
      errors: number;
      warnings: number;
      /** The first error, shown over a drawing that is out of date. */
      message?: string;
      /** Drag to pin is on (a file on disk to put the sidecar next to). */
      pinnable: boolean;
    }
  /** The text cannot be drawn now: the last drawing stays, marked out of date. */
  | { type: 'stale'; errors: number; warnings: number; message?: string }
  | { type: 'highlight'; items: { kind: Kind; id: string }[] }
  | { type: 'rasterize'; id: number; svg: string; width: number; height: number };

export type FromView =
  | { type: 'ready' }
  | { type: 'reveal'; kind: Kind; id: string }
  | { type: 'pin'; kind: 'node' | 'group'; id: string; x: number; y: number }
  | { type: 'unpin'; kind: 'node' | 'group'; id: string }
  | { type: 'view'; name: string | null }
  | { type: 'step'; n: number | null }
  | { type: 'focus'; id: string | null }
  | { type: 'command'; name: 'openEditor' | 'exportSvg' | 'exportPng' | 'exportPptx' | 'present' | 'copyShareLink' }
  | { type: 'exit' }
  | { type: 'raster'; id: number; png?: string; error?: string };

/** What the page is opened as: the preview beside the text, or the presenter. */
export interface ViewConfig {
  mode: 'preview' | 'present';
}
