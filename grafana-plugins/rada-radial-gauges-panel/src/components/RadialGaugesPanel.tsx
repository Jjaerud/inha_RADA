import React, { useEffect } from 'react';
import { PanelProps, DataFrame } from '@grafana/data';
import { RadialGaugesOptions, GaugeGradient, GRADIENT_PAIRS } from '../types';
import { injectSharedStyles } from '../inject';

interface Props extends PanelProps<RadialGaugesOptions> {}

const FONT_UI = '"Space Grotesk", system-ui, -apple-system, sans-serif';

// Look up a numeric value by exact field name across all frames.
function lookupValue(frames: DataFrame[], fieldName: string): number | null {
  for (const frame of frames) {
    const field = frame.fields.find((f) => f.name === fieldName);
    if (field && field.type === 'number') {
      // Take the most recent (last) numeric value.
      for (let i = field.values.length - 1; i >= 0; i--) {
        const v = Number(field.values[i]);
        if (Number.isFinite(v)) {
          return v;
        }
      }
    }
  }
  return null;
}

interface GaugeProps {
  label: string;
  value: number;
  gradient: GaugeGradient;
  size: number;
  showOrbit: boolean;
  showHalo: boolean;
  showFlowDash: boolean;
  showCenterDot: boolean;
}

const RadialGauge: React.FC<GaugeProps> = ({
  label, value, gradient, size, showOrbit, showHalo, showFlowDash, showCenterDot,
}) => {
  const [from, to] = GRADIENT_PAIRS[gradient];
  const stroke = size * 0.075;       // gauge ring thickness
  const cx = size / 2;
  const cy = size / 2;
  const r  = (size - stroke) / 2 - 6;  // padding for halo bleed
  const orbitR = r + stroke * 0.9 + 6;
  const haloR  = r * 0.85;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circ * (1 - clamped / 100);

  // Endpoint knob position — at the current progress angle, starting from
  // top (12 o'clock) going clockwise. svg's stroke-dashoffset on a circle
  // also starts at 3 o'clock by default; we rotate -90° to align with top.
  const angle = (clamped / 100) * 2 * Math.PI - Math.PI / 2;
  const knobX = cx + r * Math.cos(angle);
  const knobY = cy + r * Math.sin(angle);

  // Unique IDs so multiple gauges on the same page don't share gradients
  const uid = `rg-${gradient}-${size}-${Math.round(value * 10)}`;

  return (
    <div style={{ position: 'relative', width: size, height: size + 28, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={size} height={size} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id={`${uid}-arc`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
          <radialGradient id={`${uid}-halo`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={from} stopOpacity={0.55} />
            <stop offset="60%" stopColor={to} stopOpacity={0.25} />
            <stop offset="100%" stopColor={to} stopOpacity={0} />
          </radialGradient>
          <filter id={`${uid}-haloblur`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={size * 0.06} />
          </filter>
        </defs>

        {/* Halo — pulsing soft glow behind the gauge */}
        {showHalo && (
          <g style={{
            transformOrigin: `${cx}px ${cy}px`,
            animation: 'rada-halo-pulse 3.2s ease-in-out infinite',
          }}>
            <circle
              cx={cx}
              cy={cy}
              r={haloR}
              fill={`url(#${uid}-halo)`}
              filter={`url(#${uid}-haloblur)`}
            />
          </g>
        )}

        {/* Dotted orbit — slowly rotating ring outside the gauge */}
        {showOrbit && (
          <g style={{
            transformOrigin: `${cx}px ${cy}px`,
            animation: 'rada-blob-rotate-cw 28s linear infinite',
          }}>
            <circle
              cx={cx}
              cy={cy}
              r={orbitR}
              fill="none"
              stroke={from}
              strokeOpacity={0.35}
              strokeWidth={1.2}
              strokeDasharray="2 6"
            />
          </g>
        )}

        {/* Track — light gray ring */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#eef0f7"
          strokeWidth={stroke}
        />

        {/* Progress arc — gradient stroke */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={`url(#${uid}-arc)`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />

        {/* Flowing dash overlay — bright shimmer that travels around the arc.
            Implemented as a circle with a short dash + huge gap, animated by
            stroke-dashoffset so the visible chunk slides along. */}
        {showFlowDash && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.85}
            strokeWidth={stroke * 0.35}
            strokeLinecap="round"
            strokeDasharray={`${stroke * 1.5} ${circ}`}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{
              animation: 'rada-dash-flow 2.6s linear infinite',
              // Bind keyframe variable for offset target.
              ['--rg-circ' as any]: `${circ}px`,
            }}
          />
        )}

        {/* Endpoint knob — colored circle with white inner dot */}
        <circle cx={knobX} cy={knobY} r={stroke * 0.55} fill={to} stroke="#ffffff" strokeWidth={2} />
        {showCenterDot && (
          <circle cx={knobX} cy={knobY} r={stroke * 0.2} fill="#ffffff" />
        )}

        {/* Center value */}
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontFamily: FONT_UI,
            fontSize: size * 0.22,
            fontWeight: 700,
            fill: '#0d1226',
            letterSpacing: '-0.03em',
          }}
        >
          {clamped.toFixed(1)}
          <tspan style={{ fontSize: size * 0.12, fontWeight: 500, fill: '#52587a' }}>%</tspan>
        </text>
      </svg>

      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 12,
          color: '#52587a',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginTop: 6,
        }}
      >
        {label}
      </div>
    </div>
  );
};

export const RadialGaugesPanel: React.FC<Props> = ({ data, options, width, height }) => {
  useEffect(() => { injectSharedStyles(); }, []);

  const v1 = options.demoMode ? options.g1Demo : (lookupValue(data.series, options.g1Field) ?? options.g1Demo);
  const v2 = options.demoMode ? options.g2Demo : (lookupValue(data.series, options.g2Field) ?? options.g2Demo);
  const v3 = options.demoMode ? options.g3Demo : (lookupValue(data.series, options.g3Field) ?? options.g3Demo);

  // Auto-size gauges to fit horizontally (3 gauges + gaps) and not exceed
  // the panel's vertical space (also leaving room for header + label).
  const headerH = 70;
  const labelH = 28;
  const availPerGaugeW = (width - 96) / 3;   // 3 gauges + 2 gaps + side pad
  const availH = height - headerH - labelH - 16;
  const sz = Math.max(70, Math.min(options.gaugeSize, availPerGaugeW, availH));

  return (
    <div
      style={{
        width,
        height,
        background: `
          radial-gradient(ellipse 140% 110% at 100% 0%, rgba(0,196,212,0.20) 0%, transparent 78%),
          linear-gradient(135deg, #ffffff 0%, #fafbff 100%)
        `,
        borderRadius: 18,
        border: '1px solid rgba(15,20,50,0.06)',
        boxShadow: '0 1px 3px rgba(15,20,50,0.04), 0 8px 32px rgba(15,20,50,0.06)',
        overflow: 'hidden',
        padding: '18px 22px',
        fontFamily: FONT_UI,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
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

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          padding: '8px 0',
        }}
      >
        <RadialGauge
          label={options.g1Label}
          value={v1}
          gradient={options.g1Gradient}
          size={sz}
          showOrbit={options.showOrbit}
          showHalo={options.showHalo}
          showFlowDash={options.showFlowDash}
          showCenterDot={options.showCenterDot}
        />
        <RadialGauge
          label={options.g2Label}
          value={v2}
          gradient={options.g2Gradient}
          size={sz}
          showOrbit={options.showOrbit}
          showHalo={options.showHalo}
          showFlowDash={options.showFlowDash}
          showCenterDot={options.showCenterDot}
        />
        <RadialGauge
          label={options.g3Label}
          value={v3}
          gradient={options.g3Gradient}
          size={sz}
          showOrbit={options.showOrbit}
          showHalo={options.showHalo}
          showFlowDash={options.showFlowDash}
          showCenterDot={options.showCenterDot}
        />
      </div>
    </div>
  );
};
