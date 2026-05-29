import React, { useEffect } from 'react';
import { PanelProps } from '@grafana/data';
import { BlobGaugeOptions } from '../types';
import { injectSharedStyles } from '../inject';

interface Props extends PanelProps<BlobGaugeOptions> {}

const FONT_UI = '"Space Grotesk", system-ui, -apple-system, sans-serif';

// Six lobe color stops — saturated palette that blends into the organic glow
// behind the central dark disc. Order matches the design (mockup) — emerald,
// cyan, violet, pink, amber, rose — distributed evenly around the circle.
const LOBE_COLORS = [
  '#10b981', // emerald
  '#00c4d4', // cyan
  '#6d4cff', // violet
  '#a78bfa', // purple
  '#f5588c', // pink
  '#f43f5e', // rose
];

function firstNumericValue(data: PanelProps['data']): number | null {
  for (const frame of data.series) {
    for (const field of frame.fields) {
      if (field.type === 'number') {
        for (let i = 0; i < field.values.length; i++) {
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

// Render 6 colored circles around (cx, cy) at radius r. Used twice — inner
// lobes (smaller, brighter, rotating clockwise) and outer halo (larger, more
// transparent, counter-rotating).
const Lobes: React.FC<{
  cx: number;
  cy: number;
  radius: number;
  lobeR: number;
  opacity: number;
}> = ({ cx, cy, radius, lobeR, opacity }) => {
  return (
    <>
      {LOBE_COLORS.map((color, i) => {
        const a = (i / LOBE_COLORS.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + radius * Math.cos(a);
        const y = cy + radius * Math.sin(a);
        return <circle key={i} cx={x} cy={y} r={lobeR} fill={color} opacity={opacity} />;
      })}
    </>
  );
};

export const BlobGaugePanel: React.FC<Props> = ({ data, options, width, height }) => {
  useEffect(() => { injectSharedStyles(); }, []);

  const liveValue = firstNumericValue(data);
  const value = options.demoMode || liveValue == null ? options.demoValue : liveValue;
  const clamped = Math.max(0, Math.min(100, value));

  // Layout: blob occupies the LEFT portion (~50% of card width). Right side
  // holds the labels + delta + subline.
  const cardPad = 18;
  const blobBoxSize = Math.min(options.size * 1.6, height - cardPad * 2, (width - cardPad * 2) * 0.55);
  const cx = blobBoxSize / 2;
  const cy = blobBoxSize / 2;

  // Inner lobes orbit at smaller radius with bigger lobe size — appear as the
  // bright color "petals" around the dark disc. Outer halo orbits at larger
  // radius with smaller individual blur — appears as the soft outer glow.
  const innerOrbit = blobBoxSize * 0.22;
  const innerLobeR = blobBoxSize * 0.22;
  const outerOrbit = blobBoxSize * 0.32;
  const outerLobeR = blobBoxSize * 0.20;
  const discR = blobBoxSize * 0.30;   // central dark disc

  const deltaBg = options.deltaIsNegative
    ? 'rgba(244,63,94,0.18)'
    : 'rgba(0,181,116,0.20)';
  const deltaFg = options.deltaIsNegative ? '#ff8aa3' : '#5de2c4';

  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        background: '#0d1226',
        borderRadius: 18,
        padding: `${cardPad}px ${cardPad + 4}px`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25), 0 12px 40px rgba(0,0,0,0.35)',
        fontFamily: FONT_UI,
      }}
    >
      {/* decorative stars */}
      {options.showStars && (
        <svg
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          width="100%"
          height="100%"
        >
          {[
            [22, 22, 1, 0.5],   [50, 14, 0.8, 0.35],
            [200, 160, 1, 0.4], [280, 20, 0.8, 0.45],
            [80, 170, 0.9, 0.4],[330, 120, 0.8, 0.35],
            [400, 80, 0.7, 0.4],[150, 30, 0.6, 0.3],
          ].map(([x, y, r, o], i) => (
            <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity={o} />
          ))}
        </svg>
      )}

      {/* organic blob — two rotating layers of colored circles, heavy blur,
          central dark disc with value */}
      <div style={{ position: 'relative', width: blobBoxSize, height: blobBoxSize, flex: '0 0 auto' }}>
        <svg width={blobBoxSize} height={blobBoxSize} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <filter id="blob-blur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={blobBoxSize * 0.06} />
            </filter>
            <filter id="blob-blur-soft" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={blobBoxSize * 0.10} />
            </filter>
          </defs>

          {/* Outer halo — counter-rotating slowly. transformOrigin pins
              rotation around the SVG centre; otherwise it would orbit (0,0). */}
          <g
            filter="url(#blob-blur-soft)"
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              animation: 'rada-blob-rotate-ccw 28s linear infinite',
            }}
          >
            <Lobes cx={cx} cy={cy} radius={outerOrbit} lobeR={outerLobeR} opacity={0.55} />
          </g>

          {/* Inner bright lobes — clockwise faster */}
          <g
            filter="url(#blob-blur)"
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              animation: 'rada-blob-rotate-cw 18s linear infinite',
            }}
          >
            <Lobes cx={cx} cy={cy} radius={innerOrbit} lobeR={innerLobeR} opacity={0.95} />
          </g>

          {/* Central dark disc — anchors the number on top of the swirling
              glow. Slight blur on edges via shadow for soft seam. */}
          <circle
            cx={cx}
            cy={cy}
            r={discR}
            fill="#0d1226"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />

          {/* Value */}
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            style={{
              fontFamily: FONT_UI,
              fontSize: blobBoxSize * 0.18,
              fontWeight: 700,
              fill: '#ffffff',
              letterSpacing: '-0.03em',
            }}
          >
            {clamped.toFixed(1)}
            <tspan style={{ fontSize: blobBoxSize * 0.10, fontWeight: 500, fill: 'rgba(255,255,255,0.6)' }}>
              %
            </tspan>
          </text>
        </svg>
      </div>

      {/* text block */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
        <span
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          {options.labelTopText}
        </span>
        <span
          style={{
            fontSize: 17,
            color: '#ffffff',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            lineHeight: 1.3,
            marginTop: 2,
          }}
        >
          {options.labelMainText}
        </span>
        {options.showDelta && options.deltaValue && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              alignSelf: 'flex-start',
              marginTop: 10,
              padding: '3px 9px',
              borderRadius: 999,
              background: deltaBg,
              color: deltaFg,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {options.deltaValue}
          </div>
        )}
        {options.sublineText && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
            {options.sublineText}
          </span>
        )}
      </div>
    </div>
  );
};
