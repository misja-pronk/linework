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

  it('a wide window keeps everything open', () => {
    const p = folder(1920, true);
    expect(p.editorMode).toBe('open');
    expect(p.editor).toBeGreaterThanOrEqual(400);
  });
});
