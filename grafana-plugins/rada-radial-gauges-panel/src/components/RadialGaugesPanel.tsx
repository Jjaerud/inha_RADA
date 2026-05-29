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
  const stroke = size * 0.108;        // ring thickness (≈14 @ size 130, 원본 스펙)
  const cx = size / 2;
  const cy = size / 2;
  const r  = (size - stroke) / 2 - 4;
  const orbitR = r + stroke + 6;      // 원본 orbitSize = size + 28
  const clamped = Math.max(0, Math.min(100, value));
  const frac = clamped / 100;

  // 원본 RadialGauge: 완전한 원이 아니라 270° 열린 arc.
  // 시작 좌하단(-225°) → 윗쪽을 지나 → 끝 우하단(+45°), 아래가 비어 있음.
  const START_DEG = -225;
  const SWEEP_DEG = 270;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arcLen = r * toRad(SWEEP_DEG);
  const pt = (deg: number): [number, number] => {
    const a = toRad(deg);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const [sx, sy] = pt(START_DEG);
  const [ex, ey] = pt(START_DEG + SWEEP_DEG);
  // largeArc=1 (270>180), sweep=1 (각도 증가 방향 = 윗쪽 경유)
  const arcPath = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  const valueOffset = arcLen * (1 - frac);                 // start(좌하단)부터 frac 채움
  const [knobX, knobY] = pt(START_DEG + SWEEP_DEG * frac); // value arc 끝점

  // Unique IDs so multiple gauges on the same page don't share gradients
  const uid = `rg-${gradient}-${size}-${Math.round(value * 10)}`;

  return (
    <div style={{ position: 'relative', width: size, height: size + 28, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* 배경 halo — 원본: radial-gradient + halo-pulse */}
      {showHalo && (
        <div
          style={{
            position: 'absolute',
            top: (size - size * 0.92) / 2,
            left: (size - size * 0.92) / 2,
            width: size * 0.92,
            height: size * 0.92,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${from}33 0%, ${to}10 55%, transparent 75%)`,
            animation: 'rada-halo-pulse 3.2s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}
      <svg width={size} height={size} style={{ overflow: 'visible', position: 'relative' }}>
        <defs>
          <linearGradient id={`${uid}-arc`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>

        {/* 바깥 점선 orbit — 천천히 회전 (원본: rada-spin 28s, dash "4 9") */}
        {showOrbit && (
          <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'rada-blob-rotate-cw 28s linear infinite' }}>
            <circle cx={cx} cy={cy} r={orbitR} fill="none" stroke={from}
              strokeOpacity={0.28} strokeWidth={1.4} strokeDasharray="4 9" />
          </g>
        )}

        {/* track — 270° 회색 arc */}
        <path d={arcPath} fill="none" stroke="#eef0f7" strokeWidth={stroke} strokeLinecap="round" />

        {/* value arc — gradient, 좌하단부터 frac 만큼 채움 */}
        <path d={arcPath} fill="none" stroke={`url(#${uid}-arc)`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={arcLen} strokeDashoffset={valueOffset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }} />

        {/* 흐르는 dash — arc 위 하이라이트가 흐름 (원본: animate dashoffset 2.6s) */}
        {showFlowDash && (
          <path d={arcPath} fill="none" stroke={to} strokeOpacity={0.55}
            strokeWidth={stroke * 0.4} strokeLinecap="round"
            strokeDasharray={`${(stroke * 1.4).toFixed(1)} ${arcLen.toFixed(1)}`}>
            <animate attributeName="stroke-dashoffset" from={arcLen.toFixed(1)} to="0"
              dur="2.6s" repeatCount="indefinite" />
          </path>
        )}

        {/* 끝점 knob — 색 원 + 흰 내부 (원본: outer thickness*0.85, inner *0.45) */}
        <circle cx={knobX} cy={knobY} r={stroke * 0.85} fill={to} stroke="#ffffff" strokeWidth={2} />
        {showCenterDot && (
          <circle cx={knobX} cy={knobY} r={stroke * 0.45} fill="#ffffff" />
        )}

        {/* 중앙 값 */}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
          style={{ fontFamily: FONT_UI, fontSize: size * 0.24, fontWeight: 700, fill: '#0d1226', letterSpacing: '-0.03em' }}>
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

  // demoMode 꺼지면 실데이터만 (없으면 0). 예전엔 데이터 없을 때 gNDemo 로
  // fallback 해 운영 대시보드에 가짜값이 떴음 (pilot 발견).
  const v1 = options.demoMode ? options.g1Demo : (lookupValue(data.series, options.g1Field) ?? 0);
  const v2 = options.demoMode ? options.g2Demo : (lookupValue(data.series, options.g2Field) ?? 0);
  const v3 = options.demoMode ? options.g3Demo : (lookupValue(data.series, options.g3Field) ?? 0);

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
