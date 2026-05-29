import React, { useEffect, useRef, useState } from 'react';
import { PanelProps } from '@grafana/data';
import { StatCardOptions } from '../types';
import { injectSharedStyles } from '../inject';

interface Props extends PanelProps<StatCardOptions> {}

const FONT_UI = '"Space Grotesk", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

const THEME: Record<
  StatCardOptions['theme'],
  { fg: string; gradFrom: string; gradTo: string; bgHint: string }
> = {
  rose:   { fg: '#f43f5e', gradFrom: '#f43f5e', gradTo: '#f5588c', bgHint: 'rgba(244,63,94,0.25)' },
  amber:  { fg: '#ff7849', gradFrom: '#fbbf24', gradTo: '#ff7849', bgHint: 'rgba(255,120,73,0.25)' },
  gray:   { fg: '#52587a', gradFrom: '#aeb4ce', gradTo: '#52587a', bgHint: 'rgba(82,88,122,0.20)' },
  violet: { fg: '#6d4cff', gradFrom: '#6d4cff', gradTo: '#a78bfa', bgHint: 'rgba(109,76,255,0.25)' },
  mint:   { fg: '#00b574', gradFrom: '#00b574', gradTo: '#00c4d4', bgHint: 'rgba(0,181,116,0.23)' },
  cyan:   { fg: '#00c4d4', gradFrom: '#00c4d4', gradTo: '#3b82f6', bgHint: 'rgba(0,196,212,0.23)' },
};

function extractValue(data: PanelProps['data']): number | null {
  for (const frame of data.series) {
    for (const field of frame.fields) {
      if (field.type === 'number') {
        for (let i = field.values.length - 1; i >= 0; i--) {
          const v = Number(field.values[i]);
          if (Number.isFinite(v)) {
            return v;
          }
        }
      }
    }
  }
  return null;
}

function extractSparkline(data: PanelProps['data']): number[] {
  for (const frame of data.series) {
    for (const field of frame.fields) {
      if (field.type === 'number') {
        const out: number[] = [];
        for (let i = 0; i < field.values.length; i++) {
          const v = Number(field.values[i]);
          if (Number.isFinite(v)) {
            out.push(v);
          }
        }
        if (out.length >= 2) {
          return out;
        }
      }
    }
  }
  return [];
}

// ── Sparkline with x-axis labels + hover tooltip ────────────────────────
interface SparklineProps {
  data: number[];
  color: string;
  gradFrom: string;
  gradTo: string;
  height: number;
  width: number;
  xLabels: string[];           // evenly-spaced labels under the sparkline
  tooltipFormat: string;       // template with {value}
}

const Sparkline: React.FC<SparklineProps> = ({
  data, color, gradFrom, gradTo, height, width, xLabels, tooltipFormat,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length < 2) {
    return null;
  }

  // padding: top for tooltip room, bottom for x-labels
  const padTop = 18;
  const padBot = 18;
  const inH = height - padTop - padBot;
  const xs = (i: number) => (i / (data.length - 1)) * width;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const rng = max - min || 1;
  const ys = (v: number) => padTop + inH - ((v - min) / rng) * inH;

  // smooth path
  const pts = data.map((v, i) => [xs(i), ys(v)] as [number, number]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cx = (p0[0] + p1[0]) / 2;
    d += ` C${cx.toFixed(1)},${p0[1].toFixed(1)} ${cx.toFixed(1)},${p1[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
  }
  const lineBottomY = padTop + inH;
  const area = `${d} L${xs(data.length - 1).toFixed(1)},${lineBottomY} L0,${lineBottomY} Z`;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const localX = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.max(0, Math.min(data.length - 1, Math.round((localX / width) * (data.length - 1))));
    setHoverIdx(idx);
  };

  const tipText = hoverIdx == null ? '' : tooltipFormat.replace('{value}', String(data[hoverIdx]));

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      onMouseMove={onMove}
      onMouseLeave={() => setHoverIdx(null)}
      style={{ display: 'block', cursor: 'crosshair' }}
    >
      <defs>
        <linearGradient id={`sl-area-${gradFrom}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={gradFrom} stopOpacity={0.28} />
          <stop offset="100%" stopColor={gradTo} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sl-area-${gradFrom})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

      {/* x-axis labels evenly spaced */}
      {xLabels.map((label, i) => {
        const x = (i / (xLabels.length - 1)) * width;
        return (
          <text
            key={i}
            x={x}
            y={height - 4}
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            style={{ fontFamily: FONT_MONO, fontSize: 9.5, fill: '#8b91ad' }}
          >
            {label}
          </text>
        );
      })}

      {/* hover indicator */}
      {hoverIdx != null && (
        <>
          <line
            x1={xs(hoverIdx)}
            x2={xs(hoverIdx)}
            y1={padTop}
            y2={lineBottomY}
            stroke={color}
            strokeOpacity={0.4}
            strokeDasharray="3 3"
          />
          <circle cx={xs(hoverIdx)} cy={ys(data[hoverIdx])} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5} />
          {/* tooltip pill — anchored above the point. clamp x so it doesn't overflow card edges. */}
          {(() => {
            const tipW = Math.max(50, tipText.length * 7 + 16);
            const tipH = 20;
            let tx = xs(hoverIdx) - tipW / 2;
            if (tx < 2) {
              tx = 2;
            }
            if (tx + tipW > width - 2) {
              tx = width - 2 - tipW;
            }
            const ty = Math.max(2, ys(data[hoverIdx]) - tipH - 8);
            return (
              <g pointerEvents="none">
                <rect x={tx} y={ty} width={tipW} height={tipH} rx={5} fill={color} />
                <text
                  x={tx + tipW / 2}
                  y={ty + tipH / 2 + 3}
                  textAnchor="middle"
                  style={{ fontFamily: FONT_UI, fontSize: 11, fill: '#fff', fontWeight: 600 }}
                >
                  {tipText}
                </text>
              </g>
            );
          })()}
        </>
      )}
    </svg>
  );
};

export const StatCardPanel: React.FC<Props> = ({ data, options, width, height }) => {
  useEffect(() => { injectSharedStyles(); }, []);
  const liveValue = extractValue(data);
  const liveSpark = extractSparkline(data);

  // demoMode 꺼지면 실데이터만(없으면 0/빈 스파크). 예전엔 데이터 없을 때
  // demo 로 fallback 해 운영 대시보드에 가짜값이 떴음 (pilot 발견).
  const value =
    options.demoMode
      ? options.demoValue
      : (liveValue == null ? 0 : liveValue);
  const spark =
    options.demoMode
      ? options.demoSparkline.split(',').map((s) => Number(s)).filter((n) => Number.isFinite(n))
      : liveSpark;

  const th = THEME[options.theme];
  const deltaColor = options.deltaIsBad ? '#f43f5e' : '#00b574';
  const deltaArrow =
    options.deltaDirection === 'up' ? '▲' : options.deltaDirection === 'down' ? '▼' : '—';

  // formatted value — strip trailing .0 for ints
  const valueDisplay = Number.isInteger(value) ? value.toString() : value.toFixed(1);

  const xLabels = options.xLabels.split(',').map((s) => s.trim()).filter(Boolean);
  const sparkY = height - options.sparklineHeight;

  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        background: `
          radial-gradient(ellipse 140% 110% at 100% 0%, ${th.bgHint} 0%, transparent 78%),
          linear-gradient(135deg, #ffffff 0%, #fafbff 100%)
        `,
        borderRadius: 18,
        border: '1px solid rgba(15,20,50,0.06)',
        boxShadow: '0 1px 3px rgba(15,20,50,0.04), 0 8px 32px rgba(15,20,50,0.06)',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        gap: 6,
        fontFamily: FONT_UI,
      }}
    >
      {/* Category */}
      <div
        style={{
          fontSize: 11,
          color: '#8b91ad',
          letterSpacing: '0.08em',
          fontWeight: 500,
          textTransform: 'uppercase',
        }}
      >
        {options.category}
      </div>

      {/* Label — bold, dark */}
      <div
        style={{
          fontSize: 16,
          color: '#0d1226',
          fontWeight: 700,
          letterSpacing: '-0.01em',
          marginTop: -2,
        }}
      >
        {options.label}
      </div>

      {/* Value + delta — value is theme-colored bold, delta is arrow+text */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
        <span
          style={{
            fontSize: 36,
            fontWeight: 800,
            color: th.fg,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          {valueDisplay}
        </span>
        {options.unit && (
          <span
            style={{
              fontSize: 13,
              color: '#8b91ad',
              fontWeight: 500,
            }}
          >
            {options.unit}
          </span>
        )}
        {options.showDelta && options.deltaValue && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: deltaColor,
              fontFamily: FONT_MONO,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            <span style={{ fontSize: 10, lineHeight: 1 }}>{deltaArrow}</span>
            {options.deltaValue}
          </span>
        )}
      </div>

      {/* Sparkline fills bottom region */}
      {options.showSparkline && spark.length >= 2 && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 16,
            right: 16,
            height: options.sparklineHeight,
            pointerEvents: 'auto',
          }}
        >
          <Sparkline
            data={spark}
            color={th.fg}
            gradFrom={th.gradFrom}
            gradTo={th.gradTo}
            height={options.sparklineHeight}
            width={width - 32}
            xLabels={xLabels}
            tooltipFormat={options.tooltipFormat}
          />
        </div>
      )}
    </div>
  );
};
