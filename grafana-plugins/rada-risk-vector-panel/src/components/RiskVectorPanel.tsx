import React, { useEffect } from 'react';
import { PanelProps } from '@grafana/data';
import { RiskVectorOptions } from '../types';
import { injectSharedStyles } from '../inject';

interface Props extends PanelProps<RiskVectorOptions> {}

const FONT_UI = '"Space Grotesk", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

const C = {
  fg: '#0d1226', fgMid: '#52587a', fgMuted: '#8b91ad',
  track: '#eef0f7', border: 'rgba(15,20,50,0.08)',
  high: '#f43f5e', neutral: '#c3c8df',
};

const AXES: Array<{ key: keyof RiskVectorOptions; label: string; sub: string }> = [
  { key: 'miningField', label: '채굴', sub: '무단 연산 · 채굴 시그니처' },
  { key: 'networkAbuseField', label: '망 남용', sub: 'DOS성 · 비정상 트래픽' },
  { key: 'threatField', label: '위협', sub: '의심 경로 · 외부 통신' },
  { key: 'agingField', label: '노후화', sub: 'HW 성능 저하 · 열' },
  { key: 'malfunctionField', label: '오작동', sub: 'runaway · 루프' },
];

const DEMO: Record<string, number | string> = {
  mining: 86, network_abuse: 55, threat: 34, aging: 27, malfunction: 18,
  primary_type: 'MINING_SUSPICION',
};

function buildRow(data: PanelProps['data']): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const frame of data.series) {
    for (const field of frame.fields) {
      if (field.values.length > 0 && row[field.name] === undefined) {
        row[field.name] = field.values[0];
      }
    }
  }
  return row;
}

export const RiskVectorPanel: React.FC<Props> = ({ data, options, width, height }) => {
  useEffect(() => { injectSharedStyles(); }, []);
  const live = buildRow(data);

  const rows = AXES.map((a) => {
    const fieldName = options[a.key] as string;
    const raw = options.demoMode ? DEMO[fieldName] : live[fieldName];
    const v = Number(raw);
    return { label: a.label, sub: a.sub, value: Number.isFinite(v) ? v : 0 };
  }).sort((x, y) => y.value - x.value);

  const max = Math.max(1, ...rows.map((r) => r.value));
  const dominant = rows[0];

  return (
    <div style={{
      width, height, boxSizing: 'border-box', overflow: 'hidden',
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16,
      padding: '14px 18px', display: 'flex', flexDirection: 'column', fontFamily: FONT_UI,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.fg }}>risk vector</span>
        <span style={{ fontSize: 11, color: C.fgMuted }}>위험 유형 5축 · 무엇으로 의심되는가</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
        {rows.map((r, i) => {
          const isTop = i === 0 && r.value > 0;
          const pct = (r.value / max) * 100;
          const barColor = isTop ? C.high : C.neutral;
          return (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 62, flex: '0 0 auto' }}>
                <div style={{ fontSize: 12.5, fontWeight: isTop ? 700 : 600, color: isTop ? C.high : C.fg }}>{r.label}</div>
              </div>
              <div style={{ flex: 1, height: 9, background: C.track, borderRadius: 5, overflow: 'hidden' }}>
                <div style={{
                  width: `${pct}%`, height: '100%', borderRadius: 5,
                  background: isTop ? `linear-gradient(90deg, #ff6b78, ${C.high})` : barColor,
                  boxShadow: isTop ? `0 0 8px ${C.high}55` : 'none',
                }} />
              </div>
              <span style={{
                width: 34, textAlign: 'right', fontFamily: FONT_MONO, fontSize: 13,
                fontWeight: 700, color: isTop ? C.high : C.fgMid, fontVariantNumeric: 'tabular-nums',
              }}>{r.value}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontFamily: FONT_MONO, fontSize: 10.5, color: C.fgMuted }}>
        지배 축 <span style={{ color: C.high, fontWeight: 600 }}>{dominant.label} {dominant.value}</span> · 점수 불변(부가 해석)
      </div>
    </div>
  );
};
