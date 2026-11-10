import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { themes } from '@cartography/theme';
import { App } from './app.tsx';
import { registerDefaultFonts } from './fonts.ts';
import './styles.css';

// The same woff2 subsets the exports embed, so the preview measures and looks the same.
registerDefaultFonts();
// Tone colours from the diagram theme, so palette tiles match what lands in the drawing.
const tones = (['light', 'dark'] as const)
  .map((name) => {
    const sel = name === 'light' ? ':root' : ":root[data-theme='dark']";
    return Object.entries(themes[name].tones)
      .map(([tone, t]) => `${sel} .tone-${tone}{--tone-fg:${t.fg};--tone-bg:${t.bg}}`)
      .join('');
  })
  .join('');
document.head.insertAdjacentHTML('beforeend', `<style>${tones}</style>`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
