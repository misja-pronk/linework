// The token layer and base styles first, then the shared controls: each component brings its own CSS after them.
import './styles.css';
import './controls.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { themes } from '@cartography/theme';
import { shareValue } from '@cartography/core';
import { App } from './app.tsx';
import { Viewer } from './viewer.tsx';
import { registerDefaultFonts } from './fonts.ts';

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

const shared = shareValue(location.hash);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* A share link opens the read-only viewer; everything else is the editor. */}
    {shared ? <Viewer value={shared} /> : <App />}
  </StrictMode>,
);
