import React, { useEffect, useMemo } from 'react';
import { PanelProps } from '@grafana/data';
import { ConcernsOptions, ConcernRow, DEMO_ROWS } from '../types';
import { injectSharedStyles } from '../inject';

interface Props extends PanelProps<ConcernsOptions> {}

const FONT_UI = '"Space Grotesk", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

const SEV_COLOR: Record<string, string> = {
  '3': '#f43f5e',
  '2': '#ff7849',
  '1': '#f5a623',
  '0': '#00b574',
  '-1': '#aeb4ce',
};
const SEV_GRAD: Record<string, [string, string]> = {
  '3': ['#ff7d9c', '#f43f5e'],
  '2': ['#fbbf24', '#ff7849'],
  '1': ['#fbbf24', '#ff7849'],
  '0': ['#5de2c4', '#10b981'],
  '-1': ['#aeb4ce', '#c3c8df'],
};
const SEV_LABEL: Record<string, string> = {
  '3': 'HIGH', '2': 'MEDIUM', '1': 'LOW', '0': 'NORMAL', '-1': 'OFFLINE',
};
const SEV_PILL_BG: Record<string, string> = {
  '3': 'rgba(244,63,94,0.15)',
  '2': 'rgba(255,120,73,0.15)',
  '1': 'rgba(245,166,35,0.15)',
  '0': 'rgba(0,181,116,0.15)',
  '-1': 'rgba(174,180,206,0.20)',
};

// Mini hex tile — same shape language as Hexmap panel
const HexTile: React.FC<{ pcId: string; severity: number; size?: number; pulse?: boolean }> = ({
  pcId, severity, size = 42, pulse = false,
}) => {
  const [g1, g2] = SEV_GRAD[String(severity)] || SEV_GRAD['0'];
  const c = SEV_COLOR[String(severity)] || SEV_COLOR['0'];
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  const gradId = `concern-hex-${severity}`;
  const num = pcId.replace(/^PC-?/, '');
  return (
    <svg width={size} height={size} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={g1} />
          <stop offset="100%" stopColor={g2} />
        </linearGradient>
      </defs>
      {pulse && severity === 3 && (
        <polygon
          points={pts.join(' ')}
          fill="none"
          stroke={c}
          strokeWidth={4}
          strokeOpacity={0.45}
          style={{ animation: 'rada-pulse-strong 1.6s ease-in-out infinite' }}
        />
      )}
      <polygon
        points={pts.join(' ')}
        fill={`url(#${gradId})`}
        stroke={c}
        strokeOpacity={0.9}
        strokeWidth={1.4}
      />
      <text
        x={cx}
        y={cy + size * 0.04}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontFamily: FONT_MONO,
          fontSize: size * 0.32,
          fontWeight: 700,
          fill: '#fff',
          letterSpacing: '-0.02em',
        }}
      >
        {num}
      </text>
    </svg>
  );
};

// Mini sparkline (decorative — same severity color)
const MiniSparkline: React.FC<{ color: string; width: number; height: number; seed: number }> = ({
  color, width, height, seed,
}) => {
  // deterministic gentle wave from seed
  const N = 24;
  const data: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    data.push(0.5 + Math.sin(seed + t * 5) * 0.25 + Math.sin(seed * 1.7 + t * 9) * 0.12);
  }
  const xs = (i: number) => (i / (N - 1)) * width;
  const ys = (v: number) => (1 - v) * (height - 8) + 4;
  const pts = data.map((v, i) => [xs(i), ys(v)] as [number, number]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cx = (p0[0] + p1[0]) / 2;
    d += ` C${cx.toFixed(1)},${p0[1].toFixed(1)} ${cx.toFixed(1)},${p1[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
  }
  const area = `${d} L${width},${height} L0,${height} Z`;
  const gradId = `concern-spark-${seed}`;
  return (
    <svg width={width} height={height}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
};

function extractRows(data: PanelProps['data'], options: ConcernsOptions): ConcernRow[] {
  const rows: ConcernRow[] = [];
  for (const frame of data.series) {
    const find = (name: string) => frame.fields.find((f) => f.name === name);
    const pcIdF = find(options.pcIdField);
    const sevF = find(options.severityField);
    const typeF = find(options.typeField);
    const descF = find(options.descriptionField);
    const scoreF = find(options.scoreField);
    const minF = find(options.minutesAgoField);
    if (!pcIdF) {
      continue;
    }
    for (let i = 0; i < frame.length; i++) {
      const sevRaw = sevF ? sevF.values[i] : 0;
      let severity: ConcernRow['severity'] = 0;
      if (typeof sevRaw === 'number') {
        severity = (sevRaw >= -1 && sevRaw <= 3 ? sevRaw : 0) as ConcernRow['severity'];
      } else if (typeof sevRaw === 'string') {
        const m: Record<string, ConcernRow['severity']> = { NORMAL: 0, LOW: 1, MEDIUM: 2, HIGH: 3, OFFLINE: -1 };
        severity = m[sevRaw.toUpperCase()] ?? 0;
      }
      rows.push({
        pcId: String(pcIdF.values[i] ?? ''),
        severity,
        type: typeF ? String(typeF.values[i] ?? '') : '',
        description: descF ? String(descF.values[i] ?? '') : undefined,
        score: scoreF ? Number(scoreF.values[i]) || 0 : 0,
        minutesAgo: minF ? Number(minF.values[i]) || 0 : 0,
      });
    }
  }
  return rows.sort((a, b) => b.severity - a.severity || b.score - a.score);
}

// Per-theme top-right radial accent — matches design palette (RADA tokens)
const CARD_THEME: Record<ConcernsOptions['cardTheme'], string> = {
  rose:   'rgba(244,63,94,0.22)',
  amber:  'rgba(255,120,73,0.22)',
  cool:   'rgba(59,130,246,0.22)',
  violet: 'rgba(109,76,255,0.22)',
  mint:   'rgba(0,181,116,0.22)',
  cyan:   'rgba(0,196,212,0.22)',
  gray:   'rgba(82,88,122,0.16)',
};

export const ConcernsPanel: React.FC<Props> = ({ data, options, width, height }) => {
  useEffect(() => { injectSharedStyles(); }, []);
  const rows = useMemo(() => {
    if (options.demoMode) {
      return DEMO_ROWS;
    }
    // demoMode 꺼지면 실데이터만 (없으면 빈 목록). 예전엔 비었을 때 DEMO_ROWS
    // 로 fallback 해 운영 대시보드에 가짜 concern 이 떴음 (pilot 발견).
    return extractRows(data, options);
  }, [data.series, options]);

  return (
    <div
      style={{
        width,
        height,
        background: `
          radial-gradient(ellipse 140% 110% at 100% 0%, ${CARD_THEME[options.cardTheme] || CARD_THEME.rose} 0%, transparent 78%),
          linear-gradient(135deg, #ffffff 0%, #fafbff 100%)
        `,
        borderRadius: 18,
        border: '1px solid rgba(15,20,50,0.06)',
        boxShadow: '0 1px 3px rgba(15,20,50,0.04), 0 8px 32px rgba(15,20,50,0.06)',
        overflow: 'hidden',
        fontFamily: FONT_UI,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          padding: '18px 22px 10px',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0d1226', letterSpacing: '-0.01em' }}>
            {options.title}
          </div>
          <div style={{ fontSize: 11.5, color: '#8b91ad', marginTop: 4, fontWeight: 500 }}>
            {options.subtitle}
          </div>
        </div>
        {options.actionLabel && (
          <div
            style={{
              fontSize: 11.5,
              color: '#8b91ad',
              fontWeight: 500,
              flex: '0 0 auto',
              alignSelf: 'flex-start',
              marginTop: 2,
            }}
          >
            {options.actionLabel}
          </div>
        )}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 14px' }}>
        {rows.slice(0, options.maxRows).map((r, i) => {
          const c = SEV_COLOR[String(r.severity)] || SEV_COLOR['0'];
          const sevLabel = SEV_LABEL[String(r.severity)] || '';
          const sevBg = SEV_PILL_BG[String(r.severity)] || 'rgba(0,0,0,0.04)';
          // Column layout: hex / pcId+badge / type+desc / [sparkline] / score+time / [arrow]
          // Sparkline + arrow are conditional — match user's anomaly-feed spec
          // (no sparkline, arrow) vs Top concerns (sparkline, no arrow).
          const cols: string[] = ['52px', '92px', '1fr'];
          if (!options.showDescription) {
            cols.push('80px'); // sparkline column
          }
          cols.push('86px'); // score + time
          if (options.showRowArrow) {
            cols.push('20px');
          }
          return (
            <div
              key={r.pcId + i}
              style={{
                display: 'grid',
                gridTemplateColumns: cols.join(' '),
                alignItems: 'center',
                gap: 14,
                padding: '12px 14px',
                borderTop: i === 0 ? 'none' : '1px solid rgba(15,20,50,0.06)',
              }}
            >
              <HexTile pcId={r.pcId} severity={r.severity} size={42} pulse />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: '#0d1226', fontWeight: 700 }}>
                  {r.pcId}
                </span>
                {sevLabel && (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 7px',
                      borderRadius: 5,
                      background: sevBg,
                      color: c,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      width: 'fit-content',
                    }}
                  >
                    {sevLabel}
                  </span>
                )}
              </div>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: '#0d1226',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.type}
                </div>
                {options.showDescription && r.description && (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: '#8b91ad',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {r.description}
                  </div>
                )}
              </div>
              {!options.showDescription && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MiniSparkline color={c} width={70} height={28} seed={r.score} />
                </div>
              )}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: c, letterSpacing: '-0.02em', lineHeight: 1 }}>
                  {r.score.toFixed(1)}
                </div>
                <div style={{ fontSize: 10, color: '#8b91ad', marginTop: 4, fontWeight: 500, letterSpacing: '0.06em' }}>
                  {options.showDescription ? `${r.minutesAgo}분 전` : 'SCORE'}
                </div>
                {!options.showDescription && (
                  <div style={{ fontSize: 10, color: '#8b91ad', marginTop: 2, fontWeight: 500 }}>
                    {r.minutesAgo}분 전
                  </div>
                )}
              </div>
              {options.showRowArrow && (
                <div style={{ fontSize: 16, color: '#c3c8df', textAlign: 'right', lineHeight: 1 }}>›</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
