// The bundled typefaces as page fonts: the preview draws without embedding, so the page itself
// must know every face a theme sets its text in. Same woff2 data the exports embed.
import { bundledFont, loadFonts, type Theme } from '@linework/theme';

const registered = new Set<string>();

function register(family: string) {
  const font = bundledFont(family);
  if (!font || registered.has(family)) return;
  registered.add(family);
  const css = Object.entries(font.woff2)
    .map(([w, b64]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2')}`)
    .join('');
  document.head.insertAdjacentHTML('beforeend', `<style data-font="${family}">${css}</style>`);
}

/** The faces every drawing may use at once: the app's own Inter and the default look's pair. */
export function registerDefaultFonts() {
  for (const family of ['Inter', 'Instrument Sans', 'Geist Mono']) register(family);
}

/** Makes sure the page has the faces of this theme (Barlow and IBM Plex arrive on first use). */
export async function registerThemeFonts(theme: Theme | undefined) {
  if (!theme) return;
  const families = [theme.font.sans, theme.font.monoFace];
  await loadFonts(families);
  for (const family of families) if (family) register(family);
}
