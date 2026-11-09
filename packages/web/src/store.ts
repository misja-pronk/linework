// Per-browser conveniences (last document, theme, split). Storage can be missing or blocked; the app works without it.
const PREFIX = 'cartography:';

export const store = {
  get<T>(key: string): T | undefined {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? undefined : (JSON.parse(v) as T);
    } catch {
      return undefined;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* private window or full storage: nothing to keep */
    }
  },
};
