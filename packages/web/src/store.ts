// Per-browser conveniences (last document, theme, split). Storage can be missing or blocked; the app works without it.
const PREFIX = 'linework:';

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

// The built-in Claude client is gone: an API key it kept is taken out of this browser.
for (const key of ['claude-key', 'claude-model']) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* no storage */
  }
}
