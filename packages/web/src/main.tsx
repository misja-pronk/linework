import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { embeddedFonts, themes } from '@cartography/theme';
import { App } from './app.tsx';
import './styles.css';

// Inter from the same woff2 subset the exports embed, so the preview measures and looks the same.
const faces = Object.entries(embeddedFonts)
  .map(([w, b64]) => `@font-face{font-family:Inter;font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2')}`)
  .join('');
// Tone colours from the diagram theme, so palette tiles match what lands in the drawing.
const tones = (['light', 'dark'] as const)
  .map((name) => {
    const sel = name === 'light' ? ':root' : ":root[data-theme='dark']";
    return Object.entries(themes[name].tones)
      .map(([tone, t]) => `${sel} .tone-${tone}{--tone-fg:${t.fg};--tone-bg:${t.bg}}`)
      .join('');
  })
  .join('');
document.head.insertAdjacentHTML('beforeend', `<style>${faces}${tones}</style>`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
