import React from 'react';

// RADA design tokens (RADA Design Guide)
export const RADA = {
  ui: '"Space Grotesk", system-ui, -apple-system, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
  bg: '#f5f6fb',
  panel: '#ffffff',
  panelHi: '#fafbff',
  border: 'rgba(15,20,50,0.08)',
  fg: '#0d1226',
  fgMid: '#52587a',
  fgMuted: '#8b91ad',
  fgDim: '#c3c8df',
  normal: '#00b574',
  low: '#f5a623',
  medium: '#ff7849',
  high: '#f43f5e',
  primary: '#6d4cff',
  cyan: '#00c4d4',
  blue: '#3b82f6',
  claude: '#c9613f',
  bgDeep: '#0d1226',
};

export const GRAD = {
  primary: ['#6d4cff', '#a78bfa'],
  hot: ['#f43f5e', '#f5588c'],
  mint: ['#00b574', '#00c4d4'],
  amber: ['#fbbf24', '#ff7849'],
  cool: ['#3b82f6', '#22d3ee'],
  cyan: ['#00c4d4', '#3b82f6'],
  violet: ['#7c5cff', '#a78bfa'],
};

export const SCORE_MAX = 20;
export const BANDS = { OBSERVE: 5, SUSPICIOUS: 9, HIGH_RISK: 14 };

export function gradeFromScore(s: number) {
  if (s >= BANDS.HIGH_RISK) return { key: 'HIGH_RISK', sev: 3 };
  if (s >= BANDS.SUSPICIOUS) return { key: 'SUSPICIOUS', sev: 2 };
  if (s >= BANDS.OBSERVE) return { key: 'OBSERVE', sev: 1 };
  return { key: 'NORMAL', sev: 0 };
}
export function gColor(sev: number) {
  return sev >= 3 ? RADA.high : sev === 2 ? RADA.medium : sev === 1 ? RADA.low : RADA.normal;
}
export function sevGlyph(sev: number) {
  return sev >= 3 ? '▲' : sev === 2 ? '◆' : sev === 1 ? '■' : '●';
}
export function zoneT(kind: string) { return kind === 'mem' ? [85, 95] : [70, 90]; }
export function zoneColor(v: number, kind: string) {
  const [a, b] = zoneT(kind);
  return v >= b ? RADA.high : v >= a ? RADA.medium : RADA.normal;
}

export function smoothD(pts: number[][]) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const mx = (p0[0] + p1[0]) / 2;
    d += ` C${mx.toFixed(1)},${p0[1].toFixed(1)} ${mx.toFixed(1)},${p1[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
  }
  return d;
}

// outline icon set (stroke 1.7) — ported verbatim
export function Ic({ name, size = 17, color = 'currentColor' }: { name: string; size?: number; color?: string }) {
  const p: any = { fill: 'none', stroke: color, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths: Record<string, JSX.Element> = {
    cpu: <g {...p}><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></g>,
    gpu: <g {...p}><rect x="3" y="7" width="18" height="11" rx="2" /><circle cx="9" cy="12.5" r="2.4" /><path d="M14 10.5h4M14 14.5h4M6 18v2M16 18v2" /></g>,
    mem: <g {...p}><rect x="4" y="8" width="16" height="9" rx="1.5" /><path d="M7 8V5M11 8V5M15 8V5M8 17v2M16 17v2" /></g>,
    score: <g {...p}><path d="M4 14a8 8 0 0 1 16 0" /><path d="M12 14l4-4" /><circle cx="12" cy="14" r="1.3" fill={color} stroke="none" /></g>,
    chart: <g {...p}><path d="M4 19V5M4 19h16" /><path d="M7 15l3-4 3 2 4-6" /></g>,
    net: <g {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.3 2.5 14.7 0 17M12 3.5c-2.5 2.3-2.5 14.7 0 17" /></g>,
    disk: <g {...p}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.6 3.1 3 7 3s7-1.4 7-3V6" /><path d="M5 12c0 1.6 3.1 3 7 3s7-1.4 7-3" /></g>,
    risk: <g {...p}><path d="M12 3l8 4v5c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V7z" /><path d="M12 9v4M12 16h.01" /></g>,
    ai: <g {...p}><rect x="5" y="7" width="14" height="11" rx="2.5" /><path d="M12 7V4M9 12h.01M15 12h.01M9.5 15h5" /><path d="M3 11v3M21 11v3" /></g>,
    trend: <g {...p}><path d="M4 19V5M4 19h16" /><path d="M7 14l3 2 3-5 4 3" /></g>,
    check: <g {...p}><path d="M4.5 12.5l4.5 4.5L19.5 7" /></g>,
    alert: <g {...p}><path d="M12 3.5l9 15.5H3z" /><path d="M12 10v4M12 17h.01" /></g>,
    clock: <g {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></g>,
    claude: <g fill={color} stroke="none">{Array.from({ length: 14 }).map((_, i) => { const a = (i / 14) * Math.PI * 2; const inner = 1.6; const outer = i % 2 === 0 ? 9.4 : 6.4; const x1 = (12 + Math.cos(a) * inner).toFixed(2), y1 = (12 + Math.sin(a) * inner).toFixed(2); const x2 = (12 + Math.cos(a) * outer).toFixed(2), y2 = (12 + Math.sin(a) * outer).toFixed(2); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={i % 2 === 0 ? 2 : 1.5} strokeLinecap="round" />; })}</g>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24">{paths[name] || null}</svg>;
}
