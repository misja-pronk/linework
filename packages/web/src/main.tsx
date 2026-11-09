import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { embeddedFonts } from '@cartography/theme';
import { App } from './app.tsx';
import './styles.css';

// Inter from the same woff2 subset the exports embed, so the preview measures and looks the same.
const faces = Object.entries(embeddedFonts)
  .map(([w, b64]) => `@font-face{font-family:Inter;font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2')}`)
  .join('');
document.head.insertAdjacentHTML('beforeend', `<style>${faces}</style>`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
