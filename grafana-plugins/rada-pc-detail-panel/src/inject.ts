// Fonts + all keyframes used by the ported PC-detail components. Idempotent.
const STYLE_ID = 'rada-pc-detail-shared-styles';

export function injectSharedStyles(): void {
  if (typeof document === 'undefined') { return; }
  if (document.getElementById(STYLE_ID)) { return; }

  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href =
    'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(fontLink);

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes rada-pulse { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:.4;transform:scale(.85);} }
    @keyframes rada-blob-rotate-cw { from{transform:rotate(0);} to{transform:rotate(360deg);} }
    @keyframes rada-blob-rotate-ccw { from{transform:rotate(0);} to{transform:rotate(-360deg);} }
    @keyframes rada-glow-breathe { 0%,100%{opacity:.35;transform:scale(.985);} 50%{opacity:.9;transform:scale(1.015);} }
    .rada-glow-breathe { animation: rada-glow-breathe 2.2s ease-in-out infinite; }
    @keyframes rada-bar-flow { 0%{background-position:200% 0;} 100%{background-position:0 0;} }
    .rada-bar-flow { animation: rada-bar-flow 2.6s linear infinite; }
  `;
  document.head.appendChild(style);
}
