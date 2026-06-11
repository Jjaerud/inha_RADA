import React, { useEffect } from 'react';
import { PanelProps } from '@grafana/data';
import { ScoreBreakdownOptions } from '../types';
import { injectSharedStyles } from '../inject';

interface Props extends PanelProps<ScoreBreakdownOptions> {}

const FONT_UI = '"Space Grotesk", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

const C = { fg: '#0d1226', fgMid: '#52587a', fgMuted: '#8b91ad', track: '#eef0f7', border: 'rgba(15,20,50,0.08)' };

// category → label + color (RADA Design Guide)
const CATS: Array<{ key: keyof ScoreBreakdownOptions; label: string; color: string }> = [
  { key: 'resourceField', label: '리소스', color: '#7c5cff' },
  { key: 'processField', label: '프로세스', color: '#ec4899' },
  { key: 'mlField', label: 'ML', color: '#f59e0b' },
  { key: 'episodeField', label: '에피소드', color: '#06b6d4' },
  { key: 'correlationField', label: '상관', color: '#84cc16' },
  { key: 'networkField', label: '네트워크', color: '#3b82f6' },
];

const DEMO: Record<string, number> = {
  resource: 4, process: 7.5, ml: 6.5, episode: 6, correlation: 5, network: 4, final: 16.8,
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

export const ScoreBreakdownPanel: React.FC<Props> = ({ data, options, width, height }) => {
  useEffect(() => { injectSharedStyles(); }, []);
  const live = buildRow(data);

  const items = CATS.map((c) => {
    const fieldName = options[c.key] as string;
    const raw = options.demoMode ? DEMO[fieldName] : live[fieldName];
    const v = Number(raw);
    return { label: c.label, color: c.color, value: Number.isFinite(v) && v > 0 ? v : 0 };
  });
  const sum = items.reduce((s, i) => s + i.value, 0) || 1;
  const finalRaw = options.demoMode ? DEMO[options.finalField] : live[options.finalField];
  const finalScore = Number(finalRaw);

  return (
    <div style={{
      width, height, boxSizing: 'border-box', overflow: 'hidden',
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16,
      padding: '14px 18px', display: 'flex', flexDirection: 'column', fontFamily: FONT_UI,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.fg }}>점수 구성 비중</span>
        <span style={{ fontSize: 11, color: C.fgMuted }}>표시용 · 합 100% (최종 score와 별개)</span>
        {Number.isFinite(finalScore) && (
          <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 12, color: C.fgMid }}>
            score <span style={{ color: C.fg, fontWeight: 700 }}>{finalScore.toFixed(1)}</span>
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 9 }}>
        {items.map((it) => {
          const pct = (it.value / sum) * 100;
          return (
            <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: it.color, flex: '0 0 auto' }} />
              <span style={{ width: 58, fontSize: 12.5, color: C.fg, flex: '0 0 auto' }}>{it.label}</span>
              <div style={{ flex: 1, height: 8, background: C.track, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: it.color }} />
              </div>
              <span style={{
                width: 38, textAlign: 'right', fontFamily: FONT_MONO, fontSize: 12.5, fontWeight: 600,
                color: C.fg, fontVariantNumeric: 'tabular-nums',
              }}>{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontFamily: FONT_MONO, fontSize: 10, color: C.fgMuted }}>
        Retrieval 유사도 → 설명 신뢰도에만 반영 (점수 0)
      </div>
    </div>
  );
};
