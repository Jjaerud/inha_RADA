import React, { useEffect, useMemo } from 'react';
import { PanelProps } from '@grafana/data';
import { VerdictRibbonOptions, RibbonSegment, DEFAULT_SEGMENTS_JSON } from '../types';
import { injectSharedStyles } from '../inject';

interface Props extends PanelProps<VerdictRibbonOptions> {}

const FONT_UI = '"Space Grotesk", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

// HSL-based color shift — varies lightness while keeping hue stable so each
// segment's pulse stays in its OWN color family (not bleached white).
function shiftLightness(hex: string, deltaL: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h /= 6;
  }
  const newL = Math.min(1, Math.max(0, l + deltaL));
  const hueToRgb = (p: number, q: number, t: number): number => {
    if (t < 0) { t += 1; }
    if (t > 1) { t -= 1; }
    if (t < 1 / 6) { return p + (q - p) * 6 * t; }
    if (t < 1 / 2) { return q; }
    if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }
    return p;
  };
  let nr: number; let ng: number; let nb: number;
  if (s === 0) {
    nr = ng = nb = Math.round(newL * 255);
  } else {
    const q = newL < 0.5 ? newL * (1 + s) : newL + s - newL * s;
    const p = 2 * newL - q;
    nr = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
    ng = Math.round(hueToRgb(p, q, h) * 255);
    nb = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
  }
  return `rgb(${nr}, ${ng}, ${nb})`;
}

function parseSegments(jsonStr: string): RibbonSegment[] {
  try {
    const arr = JSON.parse(jsonStr);
    if (Array.isArray(arr)) {
      return arr
        .filter((s) => s && typeof s === 'object')
        .map((s, i) => ({
          name: String(s.name ?? `Segment ${i + 1}`),
          count: Number(s.count) || 0,
          color: String(s.color ?? '#888'),
          colorTo: s.colorTo ? String(s.colorTo) : undefined,
        }))
        .filter((s) => s.count > 0);
    }
  } catch {
    // ignore
  }
  return [];
}

function extractSegments(data: PanelProps['data'], options: VerdictRibbonOptions): RibbonSegment[] {
  const out: RibbonSegment[] = [];
  for (const frame of data.series) {
    const findF = (n: string) => frame.fields.find((f) => f.name === n);
    const nameF = findF(options.nameField);
    const countF = findF(options.countField);
    const colorF = findF(options.colorField);
    if (!nameF || !countF) {
      continue;
    }
    for (let i = 0; i < frame.length; i++) {
      const count = Number(countF.values[i]) || 0;
      if (count <= 0) {
        continue;
      }
      out.push({
        name: String(nameF.values[i] ?? ''),
        count,
        color: colorF ? String(colorF.values[i] ?? '#888') : '#888',
      });
    }
  }
  return out;
}

// 고정 범례 — 데이터 유무와 무관하게 항상 표시한다(색 의미 가이드).
// 카테고리/색은 패널 SQL 의 verdict→color CASE 와 일치시킨다:
//   NORMAL→#00b574, SUSPICIOUS→#fbbf24, DANGEROUS/HIGH_RISK→#f43f5e.
// ai_judgment_history 는 보통 1시간 0건이라(정상 운영) ribbon 바는 비어도
// 범례는 고정으로 남아, 각 카테고리 현재 건수(0 포함)를 함께 보여준다.
const FIXED_LEGEND: Array<{ name: string; color: string; colorTo: string; match: string[] }> = [
  { name: '정상', color: '#00b574', colorTo: '#00c4d4', match: ['normal', '정상'] },
  { name: '의심', color: '#fbbf24', colorTo: '#ff7849', match: ['suspicious', 'observe'] },
  { name: '위험', color: '#f43f5e', colorTo: '#f5588c', match: ['dangerous', 'high_risk'] },
];

export const VerdictRibbonPanel: React.FC<Props> = ({ data, options, width, height }) => {
  useEffect(() => { injectSharedStyles(); }, []);

  const segments = useMemo(() => {
    if (options.demoMode) {
      return parseSegments(options.segmentsJson || DEFAULT_SEGMENTS_JSON);
    }
    // demoMode 꺼지면 실데이터만 (없으면 빈 세그먼트). 예전엔 비었을 때 demo
    // 세그먼트로 fallback 해 운영 대시보드에 가짜 분포가 떴음 (pilot 발견).
    return extractSegments(data, options);
  }, [data.series, options]);

  // 표시용 합계(0 가능)와 나눗셈용 분모를 분리한다. 예전엔 `|| 1` 로 0 을
  // 1 로 덮어써, 데이터 0건일 때 헤더에 "전체 1건" 이 뜨고 ribbon 은 그릴
  // segment 가 없어 빈 바가 됐다 (= "전체 1건인데 그래프 안 나옴" 버그).
  const total = segments.reduce((s, x) => s + x.count, 0);
  const denom = total || 1;

  // "비정상" = everything except Normal (case-insensitive name match)
  const abnormal = segments
    .filter((s) => s.name.toLowerCase() !== 'normal' && s.name !== '정상')
    .reduce((s, x) => s + x.count, 0);
  const abnormalPct = Math.round((abnormal / denom) * 100);
  const isEmpty = total === 0;

  return (
    <div
      style={{
        width,
        height,
        background: `
          radial-gradient(ellipse 140% 110% at 100% 0%, rgba(59,130,246,0.22) 0%, transparent 78%),
          linear-gradient(135deg, #ffffff 0%, #fafbff 100%)
        `,
        borderRadius: 18,
        border: '1px solid rgba(15,20,50,0.06)',
        boxShadow: '0 1px 3px rgba(15,20,50,0.04), 0 8px 32px rgba(15,20,50,0.06)',
        overflow: 'hidden',
        fontFamily: FONT_UI,
        padding: '18px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Header */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0d1226', letterSpacing: '-0.01em' }}>
          {options.title}
        </div>
        {options.subtitle && (
          <div style={{ fontSize: 11.5, color: '#8b91ad', marginTop: 4, fontWeight: 500 }}>
            {options.subtitle}
          </div>
        )}
      </div>

      {/* Totals row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginTop: 8,
        }}
      >
        <div style={{ fontSize: 11.5, color: '#8b91ad', fontWeight: 500 }}>
          전체 <span style={{ color: '#0d1226', fontWeight: 700 }}>{total}건</span>
          {isEmpty && <span style={{ marginLeft: 8, color: '#aeb4ce' }}>· 최근 1시간 판단 없음</span>}
        </div>
        {options.showAbnormalBadge && abnormal > 0 && (
          <div style={{ fontSize: 11.5, color: '#f43f5e', fontWeight: 600 }}>
            비정상 <span style={{ fontWeight: 700 }}>{abnormal}건</span> · {abnormalPct}%
          </div>
        )}
      </div>

      {/* Ribbon — stacked horizontal bars with phase-offset animated gradient */}
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: options.ribbonHeight,
          borderRadius: options.ribbonHeight / 2,
          overflow: 'hidden',
          background: 'rgba(15,20,50,0.04)',
          marginTop: 4,
        }}
      >
        {segments.map((seg, i) => {
          const pct = (seg.count / denom) * 100;
          // Two-color sweep — repeats colorFrom → colorTo → colorFrom so the
          // background-position animation produces a continuous flow within
          // the segment's OWN gradient pair (no white shine).
          const cFrom = seg.color;
          const cTo = seg.colorTo || shiftLightness(seg.color, +0.18);
          const phase = (i * 0.6).toFixed(1);
          return (
            <div
              key={i}
              title={`${seg.name} · ${seg.count}`}
              style={{
                width: `${pct}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${cFrom} 0%, ${cTo} 50%, ${cFrom} 100%)`,
                backgroundSize: '200% 100%',
                animation: options.animate
                  ? `rada-ribbon-sweep ${options.pulseDurationSec}s ease-in-out infinite`
                  : 'none',
                animationDelay: `${phase}s`,
                borderRight: i < segments.length - 1 ? '1px solid rgba(255,255,255,0.4)' : 'none',
              }}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 10,
        }}
      >
        {FIXED_LEGEND.map((cat, i) => {
          // 현재 분포(segments)에서 이 카테고리에 해당하는 건수 합산(없으면 0).
          const cnt = segments
            .filter((s) => cat.match.includes(s.name.toLowerCase()))
            .reduce((a, s) => a + s.count, 0);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  background: `linear-gradient(135deg, ${cat.color}, ${cat.colorTo})`,
                  boxShadow: `0 0 0 2px ${cat.color}25`,
                }}
              />
              <span style={{ fontFamily: FONT_UI, fontSize: 11.5, color: '#52587a', fontWeight: 500 }}>
                {cat.name}
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#0d1226', fontWeight: 700 }}>
                {cnt}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
