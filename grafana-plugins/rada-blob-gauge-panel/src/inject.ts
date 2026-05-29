// One-time injection of Google Fonts + keyframes used by RADA panel
// plugins. Idempotent — safe to call from multiple plugin modules.

const STYLE_ID = 'rada-panel-shared-styles';

export function injectSharedStyles(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  // Google Fonts — Space Grotesk (UI) + IBM Plex Mono (numbers)
  // We use a single <link> with both families.
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href =
    'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(fontLink);

  // Shared keyframes — animations referenced by panel CSS-in-JS.
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes rada-pulse-strong {
      0%, 100% { opacity: 0.35; }
      50%      { opacity: 1; }
    }
    @keyframes rada-blob-rotate-cw {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    @keyframes rada-blob-rotate-ccw {
      from { transform: rotate(0deg); }
      to   { transform: rotate(-360deg); }
    }
    @keyframes rada-halo-pulse {
      0%, 100% { transform: scale(0.92); opacity: 0.55; }
      50%      { transform: scale(1.06); opacity: 0.85; }
    }
    @keyframes rada-ribbon-sweep {
      0%, 100% { background-position: 0% 50%; }
      50%      { background-position: 100% 50%; }
    }
    /* Stroke-dashoffset sweep — used by radial gauges' flowing dash overlay.
       Element supplies --rg-circ = circumference; offset travels -circ ~ 0. */
    @keyframes rada-dash-flow {
      from { stroke-dashoffset: 0; }
      to   { stroke-dashoffset: var(--rg-circ, -200); }
    }
  `;
  document.head.appendChild(style);
}
