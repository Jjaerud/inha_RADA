import React, { useEffect, useMemo, useState } from 'react';
import { PanelProps, DataFrame } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { HexmapOptions, PcCell } from '../types';
import { injectSharedStyles } from '../inject';

// Navigate to the PC detail dashboard for a clicked cell, preserving the
// current time range / refresh / timezone query params.
function gotoDetail(detailUrl: string, pcId: string): void {
  if (!detailUrl) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  params.set('var-pc_id', pcId);
  try {
    locationService.push(`${detailUrl}?${params.toString()}`);
  } catch {
    window.location.assign(`${detailUrl}?${params.toString()}`);
  }
}

interface Props extends PanelProps<HexmapOptions> {}

// Severity → color (matches design/mockdata.jsx RADA palette + GRAD)
const SEV_COLOR = {
  '-1': '#aeb4ce',   // offline
  '0': '#00b574',    // normal
  '1': '#f5a623',    // low
  '2': '#ff7849',    // medium
  '3': '#f43f5e',    // high
} as const;

const SEV_GRAD = {
  '-1': ['#aeb4ce', '#c3c8df'],
  '0': ['#5de2c4', '#10b981'],
  '1': ['#fbbf24', '#ff7849'],
  '2': ['#fbbf24', '#ff7849'],
  '3': ['#ff7d9c', '#f43f5e'],
} as const;

const SEV_LABEL: Record<string, string> = {
  '-1': 'OFFLINE',
  '0': 'NORMAL',
  '1': 'LOW',
  '2': 'MEDIUM',
  '3': 'HIGH',
};

const FONT_UI = '"Space Grotesk", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

// Pull cells out of one or more Grafana DataFrames. Strategy:
// - If a series has a `pc_id` (or configured field) per row, use that.
// - Else fall back to series name → pc_id.
function buildCells(frames: DataFrame[], options: HexmapOptions): PcCell[] {
  if (!frames || frames.length === 0) {
    return [];
  }

  const cells: PcCell[] = [];
  const seen = new Set<string>();

  for (const frame of frames) {
    const fields = frame.fields;
    const findField = (name: string) =>
      fields.find((f) => f.name === name || f.config?.displayName === name);

    const pcIdField = findField(options.pcIdField);
    const scoreField = findField(options.scoreField);
    const severityField = findField(options.severityField);
    const cpuField = findField(options.cpuField);
    const gpuField = findField(options.gpuField);
    const memField = findField(options.memField);
    const hostnameField = findField(options.hostnameField);

    const rowCount = frame.length;
    for (let i = 0; i < rowCount; i++) {
      const pcId = pcIdField ? String(pcIdField.values[i] ?? '') : frame.name ?? `PC-${i + 1}`;
      if (!pcId || seen.has(pcId)) {
        continue;
      }
      seen.add(pcId);

      const score = scoreField ? Number(scoreField.values[i]) : NaN;
      const sevRaw = severityField ? severityField.values[i] : undefined;
      let severity: PcCell['severity'];
      if (sevRaw === -1 || sevRaw === '-1' || sevRaw === 'OFFLINE') {
        severity = -1;
      } else if (typeof sevRaw === 'number' && sevRaw >= 0 && sevRaw <= 3) {
        severity = sevRaw as PcCell['severity'];
      } else if (typeof sevRaw === 'string') {
        const m: Record<string, PcCell['severity']> = {
          NORMAL: 0, LOW: 1, MEDIUM: 2, HIGH: 3, OFFLINE: -1,
        };
        severity = m[sevRaw.toUpperCase()] ?? deriveSeverity(score, options);
      } else {
        severity = deriveSeverity(score, options);
      }

      cells.push({
        id: pcId,
        hostname: hostnameField ? String(hostnameField.values[i] ?? pcId) : pcId,
        severity,
        score: isFinite(score) ? score : null,
        cpu: cpuField ? Number(cpuField.values[i]) || 0 : 0,
        gpu: gpuField ? Number(gpuField.values[i]) || 0 : 0,
        mem: memField ? Number(memField.values[i]) || 0 : 0,
      });
    }
  }

  // NOTE: padding to a fixed roster (incl. the all-empty case) is handled by
  // applyRoster() in the component so live + offline cells merge consistently.
  return cells;
}

// Build the ordered roster id list from options.
function buildRoster(options: HexmapOptions): string[] {
  const explicit = (options.rosterIds || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length > 0) {
    return explicit;
  }
  const n = options.fillToCount > 0 ? Math.floor(options.fillToCount) : 0;
  return Array.from({ length: n }, (_, i) => `PC-${String(i + 1).padStart(2, '0')}`);
}

function offlineCell(id: string): PcCell {
  return { id, hostname: id, severity: -1, score: null, cpu: 0, gpu: 0, mem: 0 };
}

// Merge live cells onto a fixed roster. Roster slots without live data render
// OFFLINE. Any live PC not in the roster is appended after the roster so it is
// never hidden.
function applyRoster(live: PcCell[], options: HexmapOptions): PcCell[] {
  const roster = buildRoster(options);
  if (roster.length === 0) {
    return live;
  }
  const liveById = new Map(live.map((c) => [c.id, c]));
  const out: PcCell[] = roster.map((id) => liveById.get(id) ?? offlineCell(id));
  const rosterSet = new Set(roster);
  for (const c of live) {
    if (!rosterSet.has(c.id)) {
      out.push(c);
    }
  }
  return out;
}

// Same mock distribution as design/mockdata.jsx PCS — for demo mode when
// no live data is available (visual design verification).
function buildDemoCells(): PcCell[] {
  const high = new Set(['PC-07', 'PC-13']);
  const medium = new Set(['PC-04', 'PC-21', 'PC-29', 'PC-33']);
  const offline = new Set(['PC-18']);
  const out: PcCell[] = [];
  for (let i = 1; i <= 40; i++) {
    const id = `PC-${String(i).padStart(2, '0')}`;
    let severity: PcCell['severity'] = 0;
    if (high.has(id)) {
      severity = 3;
    } else if (medium.has(id)) {
      severity = 2;
    } else if (offline.has(id)) {
      severity = -1;
    }
    const seed = i * 9973;
    const rnd = (k: number) => {
      const x = Math.sin(seed + k) * 10000;
      return x - Math.floor(x);
    };
    let cpu = 0, gpu = 0, mem = 0, score: number | null = 0;
    if (severity === 3) {
      cpu = 80 + rnd(1) * 15;
      gpu = 88 + rnd(2) * 10;
      mem = 60 + rnd(3) * 20;
      score = id === 'PC-07' ? 42.5 : id === 'PC-13' ? 38.2 : 32 + rnd(5) * 6;
    } else if (severity === 2) {
      cpu = 55 + rnd(1) * 20;
      gpu = 45 + rnd(2) * 25;
      mem = 50 + rnd(3) * 20;
      const ms: Record<string, number> = { 'PC-04': 24, 'PC-21': 21.5, 'PC-29': 19, 'PC-33': 18.2 };
      score = ms[id] ?? 17 + rnd(5) * 5;
    } else if (severity === -1) {
      score = null;
    } else {
      cpu = 8 + rnd(1) * 22;
      gpu = 5 + rnd(2) * 20;
      mem = 22 + rnd(3) * 28;
      score = +(1.5 + rnd(5) * 7).toFixed(1);
    }
    out.push({
      id,
      hostname: `lab01-pc-${String(i).padStart(2, '0')}`,
      severity,
      score: score == null ? null : +score.toFixed(1),
      cpu: +cpu.toFixed(1),
      gpu: +gpu.toFixed(1),
      mem: +mem.toFixed(1),
    });
  }
  return out;
}

function deriveSeverity(score: number, opt: HexmapOptions): PcCell['severity'] {
  if (!isFinite(score)) {
    return -1;
  }
  if (score >= opt.thresholdHigh) {
    return 3;
  }
  if (score >= opt.thresholdMedium) {
    return 2;
  }
  if (score >= opt.thresholdLow) {
    return 1;
  }
  return 0;
}

export const HexmapPanel: React.FC<Props> = ({ data, options, width, height }) => {
  useEffect(() => { injectSharedStyles(); }, []);
  const [hover, setHover] = useState<string | null>(null);

  const cells = useMemo(() => {
    if (options.demoMode) {
      return buildDemoCells();
    }
    // Live cells from the query, merged onto the fixed roster so non-reporting
    // PCs (e.g. a 3-PC pilot in a 40-PC grid) render as OFFLINE rather than
    // disappearing.
    const real = buildCells(data.series, options);
    return applyRoster(real, options);
  }, [data.series, options]);

  const size = options.hexSize;
  const cols = options.columns;
  const w = Math.sqrt(3) * size;
  const h = 2 * size;
  const rowH = 1.5 * size;
  const colW = w;

  const placedCells = cells.map((pc, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const cx = colW / 2 + col * colW + (row % 2 === 1 ? colW / 2 : 0);
    const cy = h / 2 + row * rowH;
    return { pc, cx, cy };
  });

  const rows = Math.ceil(cells.length / cols);
  const svgW = colW * cols + colW / 2 + 8;
  const svgH = rowH * (rows - 1) + h + 8;

  const fillFor = (sev: PcCell['severity']) => {
    if (sev === -1) {
      return '#eef0f7';
    }
    return `url(#rada-hex-grad-${sev})`;
  };

  // Tooltip placement — track in SVG user space.
  const hoverCell = placedCells.find((c) => c.pc.id === hover);

  // ── Background presets — matches React mock (rada-main · MainHoneycomb)
  // Stronger color saturation than before so the gradient is visible against
  // Grafana's own surface (which may be light or dark theme).
  const bgStyle: React.CSSProperties = (() => {
    switch (options.background) {
      case 'lightGradient':
        return {
          // Single soft mesh anchored at top-right, fading toward bottom-left.
          // Matches the other RADA panel cards (Threat/Watch/etc).
          background: `
            radial-gradient(ellipse 140% 110% at 100% 0%, rgba(109,76,255,0.18) 0%, transparent 78%),
            linear-gradient(135deg, #ffffff 0%, #fafbff 100%)
          `,
        };
      case 'darkGradient':
        return {
          background: `
            radial-gradient(ellipse at 12% 0%, rgba(109,76,255,0.32) 0%, transparent 48%),
            radial-gradient(ellipse at 92% 100%, rgba(244,63,94,0.22) 0%, transparent 50%),
            linear-gradient(135deg, #0d1226 0%, #1a1f3a 60%, #0d1226 100%)
          `,
        };
      case 'light':
        return { background: '#f5f6fb' };
      case 'transparent':
      default:
        return { background: 'transparent' };
    }
  })();

  const isDark = options.background === 'darkGradient';
  const cardShadow =
    options.background === 'transparent'
      ? 'none'
      : isDark
      ? '0 1px 3px rgba(0,0,0,0.25), 0 8px 32px rgba(0,0,0,0.35)'
      : '0 1px 3px rgba(15,20,50,0.06), 0 12px 40px rgba(15,20,50,0.10)';
  const cardBorder =
    options.showBorder
      ? isDark
        ? '1px solid rgba(255,255,255,0.08)'
        : '1px solid rgba(15,20,50,0.08)'
      : 'none';
  const titleColor = isDark ? '#ffffff' : '#0d1226';
  const subtitleColor = isDark ? 'rgba(255,255,255,0.55)' : '#8b91ad';

  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: options.cornerRadius,
        boxShadow: cardShadow,
        border: cardBorder,
        ...bgStyle,
      }}
    >
      {/* Inline title block (matches React mock — title sits INSIDE the
          card, not as a Grafana panel header). Toggle via showInnerTitle. */}
      {options.showInnerTitle && (options.innerTitle || options.innerSubtitle) && (
        <div style={{ padding: '20px 28px 4px', position: 'relative', zIndex: 2 }}>
          {options.innerTitle && (
            <div
              style={{
                fontFamily: FONT_UI,
                fontSize: 18,
                fontWeight: 700,
                color: titleColor,
                letterSpacing: '-0.01em',
              }}
            >
              {options.innerTitle}
            </div>
          )}
          {options.innerSubtitle && (
            <div
              style={{
                fontFamily: FONT_UI,
                fontSize: 12,
                color: subtitleColor,
                marginTop: 4,
                fontWeight: 500,
              }}
            >
              {options.innerSubtitle}
            </div>
          )}
        </div>
      )}

      {/* Hexmap centered region (fills remaining space) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 28px',
          position: 'relative',
        }}
      >
      {/* Decorative honeycomb cluster — matches CardDecor "hex" variant */}
      {options.showDecor && (
        <svg
          width="180"
          height="180"
          viewBox="0 0 180 180"
          style={{
            position: 'absolute',
            bottom: -16,
            left: -16,
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          <g opacity={isDark ? 0.18 : 0.12}>
            {[
              [0, 0], [24.25, 0], [-24.25, 0],
              [12.125, 21], [-12.125, 21],
              [12.125, -21], [-12.125, -21],
            ].map(([dx, dy], i) => {
              const cx = 65 + dx;
              const cy = 95 + dy;
              const r = 14;
              const pts = [];
              for (let k = 0; k < 6; k++) {
                const a = (Math.PI / 3) * k - Math.PI / 2;
                pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
              }
              return (
                <polygon
                  key={i}
                  points={pts.join(' ')}
                  fill="none"
                  stroke={isDark ? '#6d4cff' : '#6d4cff'}
                  strokeWidth={1.4}
                />
              );
            })}
          </g>
        </svg>
      )}

      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width="100%"
        height="100%"
        style={{ maxWidth: svgW, maxHeight: svgH, overflow: 'visible' }}
      >
        <defs>
          {(['-1', '0', '1', '2', '3'] as const).map((k) => {
            const [a, b] = SEV_GRAD[k];
            return (
              <linearGradient key={k} id={`rada-hex-grad-${k}`} x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor={a} />
                <stop offset="100%" stopColor={b} />
              </linearGradient>
            );
          })}
          <filter id="rada-hex-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="rada-hex-glow-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>

        {placedCells.map(({ pc, cx, cy }) => {
          const c = SEV_COLOR[String(pc.severity) as keyof typeof SEV_COLOR];
          const isHigh = pc.severity === 3;
          const isMed = pc.severity === 2;
          const isOff = pc.severity === -1;
          const isHover = hover === pc.id;

          const pts: string[] = [];
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k - Math.PI / 2;
            pts.push(`${(cx + size * Math.cos(a) * 0.92).toFixed(2)},${(cy + size * Math.sin(a) * 0.92).toFixed(2)}`);
          }
          const ptsStr = pts.join(' ');

          const transform = isHover
            ? `translate(${cx} ${cy}) scale(1.08) translate(${-cx} ${-cy})`
            : '';
          const textOnDark = isHigh || isMed;

          return (
            <g
              key={pc.id}
              style={{ cursor: 'pointer', transition: 'transform 0.15s ease' }}
              transform={transform}
              onMouseEnter={() => setHover(pc.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => gotoDetail(options.detailUrl, pc.id)}
            >
              {isHover && !isOff && (
                <polygon
                  points={ptsStr}
                  fill="none"
                  stroke={c}
                  strokeWidth={6}
                  strokeOpacity={0.55}
                  filter="url(#rada-hex-glow)"
                />
              )}
              {/* HIGH severity: pulsing outline halo — matches design */}
              {isHigh && !isHover && (
                <polygon
                  points={ptsStr}
                  fill="none"
                  stroke={c}
                  strokeWidth={6}
                  strokeOpacity={0.45}
                  filter="url(#rada-hex-glow)"
                  style={{ animation: 'rada-pulse-strong 1.6s ease-in-out infinite' }}
                />
              )}
              {/* soft underglow for amber + high (static) */}
              {(isHigh || isMed) && !isHover && (
                <polygon
                  points={ptsStr}
                  fill={c}
                  fillOpacity={0.18}
                  filter="url(#rada-hex-glow-soft)"
                />
              )}
              <polygon
                points={ptsStr}
                fill={fillFor(pc.severity)}
                stroke={isHover ? c : isOff ? '#dadeed' : c}
                strokeOpacity={isOff ? 0.7 : 0.9}
                strokeWidth={isHover ? 2 : 1.4}
                style={{ transition: 'all 0.15s' }}
              />
              <text
                x={cx}
                y={cy - 1}
                textAnchor="middle"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: size * 0.32,
                  fontWeight: 700,
                  fill: textOnDark ? '#fff' : isOff ? '#8b91ad' : '#0d1226',
                  letterSpacing: '-0.02em',
                  pointerEvents: 'none',
                }}
              >
                {pc.id.replace(/^PC-?/, '')}
              </text>
              <text
                x={cx}
                y={cy + size * 0.42}
                textAnchor="middle"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: size * 0.175,
                  fill: textOnDark ? 'rgba(255,255,255,0.85)' : isOff ? '#8b91ad' : '#52587a',
                  letterSpacing: '0.01em',
                  fontWeight: 600,
                  pointerEvents: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {isOff ? 'offline' : pc.score != null ? pc.score.toFixed(1) : '—'}
              </text>
            </g>
          );
        })}

        {options.showTooltip && hoverCell && (() => {
          const pc = hoverCell.pc;
          const tipW = 180;
          const tipH = 80;
          let tx = hoverCell.cx - tipW / 2;
          let ty = hoverCell.cy - size - tipH - 8;
          if (tx < 4) {
            tx = 4;
          }
          if (tx + tipW > svgW - 4) {
            tx = svgW - 4 - tipW;
          }
          if (ty < 4) {
            ty = hoverCell.cy + size + 8;
          }
          const cc = SEV_COLOR[String(pc.severity) as keyof typeof SEV_COLOR];
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={tx} y={ty} width={tipW} height={tipH} rx={10}
                fill="#fff" stroke="rgba(15,20,50,0.06)"
                style={{ filter: 'drop-shadow(0 8px 24px rgba(15,20,50,0.12))' }}
              />
              <rect x={tx} y={ty} width={4} height={tipH} fill={cc} rx={2} />
              <text x={tx + 14} y={ty + 22} style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, fill: '#0d1226' }}>{pc.id}</text>
              <text x={tx + 64} y={ty + 22} style={{ fontFamily: FONT_UI, fontSize: 10.5, fill: cc, fontWeight: 600, letterSpacing: '0.06em' }}>
                {SEV_LABEL[String(pc.severity)]}
              </text>
              <text x={tx + 14} y={ty + 40} style={{ fontFamily: FONT_MONO, fontSize: 10.5, fill: '#52587a' }}>{pc.hostname}</text>
              <text x={tx + 14} y={ty + 58} style={{ fontFamily: FONT_MONO, fontSize: 10.5, fill: '#52587a' }}>
                {`CPU ${pc.cpu.toFixed(0)}%  GPU ${pc.gpu.toFixed(0)}%  RAM ${pc.mem.toFixed(0)}%`}
              </text>
            </g>
          );
        })()}
      </svg>
      </div>{/* /hexmap centered region */}

      {options.showLegend && (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            gap: 18,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '10px 28px 16px',
            zIndex: 2,
          }}
        >
          {[
            // 정상 셀에 관찰(LOW)을 합산 표시 — LOW 는 저장/표시 대상이 아니라
            // SQL 에서도 정상(0)으로 흡수되므로 범례도 정상에 통합한다.
            { sev: 0 as const, label: '정상', extra: [1] as number[] },
            { sev: 2 as const, label: '의심', extra: [] as number[] },
            { sev: 3 as const, label: '위험', extra: [] as number[] },
            { sev: -1 as const, label: '오프라인', extra: [] as number[] },
          ].map((it) => {
            const count = cells.filter(
              (c) => c.severity === it.sev || it.extra.includes(c.severity as number)
            ).length;
            const [a, b] = SEV_GRAD[String(it.sev) as keyof typeof SEV_GRAD];
            return (
              <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span
                  style={{
                    width: 12, height: 12, borderRadius: 3,
                    background: `linear-gradient(135deg, ${a}, ${b})`,
                  }}
                />
                <span style={{ fontFamily: FONT_UI, fontSize: 11.5, color: subtitleColor, fontWeight: 500 }}>
                  {it.label}
                </span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: titleColor, fontWeight: 600 }}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
