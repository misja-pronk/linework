import { describe, expect, it } from 'vitest';
import { MIN_CANVAS, paneLayout } from '../src/pane-layout.ts';

const folder = (width: number, side: boolean, forceEditor = false) =>
  paneLayout({ width, folder: true, files: 'list', view: 'code', editor: { width: width * 0.4, folded: false }, side, forceEditor });

describe('pane layout', () => {
  it('in a folder with the side panel, a YAML too narrow to read folds before the drawing gives way (review 3)', () => {
    for (const width of [1512, 1280]) {
      const p = folder(width, true);
      expect(p.editorMode).toBe('rail');
      expect(p.editorSqueezed).toBe(true);
      expect(p.filesMode).toBe('list');
      expect(p.canvas).toBeGreaterThan(MIN_CANVAS + 60);
    }
  });

  it('without the side panel the YAML stays open beside the files', () => {
    const p = folder(1512, false);
    expect(p.editorMode).toBe('open');
    expect(p.editor).toBeGreaterThanOrEqual(400);
  });

  it('opened from its rail on purpose, the YAML stays open', () => {
    expect(folder(1512, true, true).editorMode).toBe('open');
  });

  it('the builder outline folds to its rail under 1400 px, unless opened on purpose', () => {
    const builder = (width: number, outline?: 'open' | 'rail') => paneLayout({ width, folder: false, files: 'list', view: 'visual', editor: { width: 400, folded: true }, side: true, ...(outline ? { outline } : {}) });
    expect(builder(1280).shapesMode).toBe('rail');
    expect(builder(1280).canvas).toBe(1280 - 300 - 40);
    expect(builder(1440).shapesMode).toBe('open');
    expect(builder(1280, 'open').shapesMode).toBe('open');
    expect(builder(1920, 'rail').shapesMode).toBe('rail');
    expect(paneLayout({ width: 1280, folder: false, files: 'list', view: 'code', editor: { width: 400, folded: true }, side: true }).shapesMode).toBe('none');
  });

  it('a wide window keeps everything open', () => {
    const p = folder(1920, true);
    expect(p.editorMode).toBe('open');
    expect(p.editor).toBeGreaterThanOrEqual(400);
  });
});
