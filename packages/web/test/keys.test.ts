import { describe, expect, it } from 'vitest';
import { comboLabel, keyHint, keysOf, matches, sheetKeys, shortcutFor, SHORTCUTS, TOGETHER } from '../src/keys.ts';

const press = (key: string, o: { code?: string; meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  key,
  code: o.code ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : ''),
  metaKey: !!o.meta,
  ctrlKey: !!o.ctrl,
  altKey: !!o.alt,
  shiftKey: !!o.shift,
});

describe('shortcuts', () => {
  it('has unique ids', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  for (const mac of [true, false])
    for (const [where, contexts] of Object.entries(TOGETHER))
      it(`gives no key two meanings: ${where}${mac ? '' : ' (Windows, Linux)'}`, () => {
        const seen = new Map<string, string>();
        const clashes: string[] = [];
        for (const s of SHORTCUTS.filter((x) => contexts.includes(x.context)))
          for (const k of keysOf(s, mac)) {
            const other = seen.get(k);
            if (other && other !== s.id) clashes.push(`${k}: ${other} and ${s.id}`);
            seen.set(k, s.id);
          }
        expect(clashes).toEqual([]);
      });

  it('takes no browser key that matters outside the drawing', () => {
    // Global keys (anywhere, also while typing) that a browser uses for something people want.
    const browser = { mac: ['mod+d', 'mod+shift+d', 'mod+p', 'mod+l', 'mod+t', 'mod+w', 'mod+n', 'mod+0', 'mod+=', 'mod+-', 'mod+[', 'mod+]', 'mod+shift+s'], pc: ['mod+j', 'mod+d', 'mod+shift+d', 'mod+p', 'mod+l', 'mod+t', 'mod+w', 'mod+n', 'mod+0', 'mod+=', 'mod+-', 'mod+h'] };
    for (const mac of [true, false]) {
      const taken = SHORTCUTS.filter((s) => s.context === 'anywhere').flatMap((s) => keysOf(s, mac));
      expect(taken.filter((k) => (mac ? browser.mac : browser.pc).includes(k))).toEqual([]);
    }
  });

  it('reads letters whatever Caps Lock says', () => {
    expect(matches(press('T'), 't')).toBe(true);
    expect(matches(press('T', { shift: true }), 't')).toBe(false);
    expect(matches(press('N', { shift: true }), 'shift+n')).toBe(true);
    // Caps Lock on, Shift held: the browser may report either case.
    expect(matches(press('n', { shift: true }), 'shift+n')).toBe(true);
    expect(shortcutFor(press('F'), ['drawing'])).toBe('focus');
  });

  it('reads ⌥ letters by their place, as a Mac types another character', () => {
    expect(matches(press('å', { code: 'KeyA', alt: true }), 'alt+a', true)).toBe(true);
    expect(matches(press('a', { alt: true }), 'a', true)).toBe(false);
  });

  it('keeps ⌘ and Ctrl apart on a Mac, and uses Ctrl elsewhere', () => {
    expect(matches(press('k', { meta: true }), 'mod+k', true)).toBe(true);
    expect(matches(press('k', { ctrl: true }), 'mod+k', true)).toBe(false);
    expect(matches(press('k', { ctrl: true }), 'mod+k', false)).toBe(true);
    expect(matches(press(' ', { ctrl: true }), 'ctrl+space', true)).toBe(true);
    expect(matches(press('i', { ctrl: true }), 'ctrl+i', false)).toBe(true);
  });

  it('reads shifted symbols by the symbol', () => {
    expect(matches(press('?', { shift: true }), '?')).toBe(true);
    expect(matches(press('+', { shift: true }), '+')).toBe(true);
    expect(matches(press('!', { code: 'Digit1', shift: true }), 'shift+digit1')).toBe(true);
    expect(matches(press('\\', { meta: true }), 'mod+\\', true)).toBe(true);
  });

  it('writes keys as people read them', () => {
    expect(comboLabel('mod+shift+d', true)).toBe('⇧⌘D');
    expect(comboLabel('mod+shift+d', false)).toBe('Ctrl+Shift+D');
    expect(comboLabel('alt+shift+h', true)).toBe('⌥⇧H');
    expect(keyHint('ask', true)).toBe('⌘J');
    expect(keyHint('ask', false)).toBe('Ctrl+I');
    expect(sheetKeys(SHORTCUTS.find((s) => s.id === 'redo')!, true)).toBe('⇧⌘Z / ⌘Y');
  });
});
