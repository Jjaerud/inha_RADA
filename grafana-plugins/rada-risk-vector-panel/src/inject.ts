// One-time injection of Google Fonts + keyframes for the AI judgment panel.
// Mirrors the shared pattern used by the other RADA panel plugins so the card
// matches the design system (Space Grotesk / IBM Plex Mono + claude accent).
// Idempotent.

const STYLE_ID = 'rada-ai-judgment-shared-styles';

export function injectSharedStyles(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href =
    'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(fontLink);

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes rada-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.4; transform: scale(0.85); }
    }
    /* fast-path badge glow */
    @keyframes rada-glow-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(245,166,35,0.0); }
      50%      { box-shadow: 0 0 0 3px rgba(245,166,35,0.25); }
    }
  `;
  document.head.appendChild(style);
}
