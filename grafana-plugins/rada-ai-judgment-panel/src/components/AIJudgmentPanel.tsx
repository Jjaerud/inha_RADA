import React, { useEffect } from 'react';
import { PanelProps } from '@grafana/data';
import { AIJudgmentOptions } from '../types';
import { injectSharedStyles } from '../inject';

interface Props extends PanelProps<AIJudgmentOptions> {}

const FONT_UI = '"Space Grotesk", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

// Design tokens (RADA Design Guide)
const C = {
  panel: '#ffffff',
  border: 'rgba(15,20,50,0.08)',
  fg: '#0d1226',
  fgMid: '#52587a',
  fgMuted: '#8b91ad',
  track: '#eef0f7',
  claude: '#c9613f',
  zoneA0: '#2d1e15',
  zoneA1: '#16100b',
  zoneAText: '#f6e2d0',
  zoneAAccent: '#e8a87c',
  normal: '#00b574',
  low: '#f5a623',
  medium: '#ff7849',
  high: '#f43f5e',
};

// verdict / severity → semantic color
function sevColor(v: string): string {
  const s = (v || '').toUpperCase();
  if (s.includes('HIGH')) return C.high;
  if (s.includes('SUSPICIOUS') || s === 'MEDIUM') return C.medium;
  if (s.includes('OBSERVE') || s === 'LOW') return C.low;
  return C.normal;
}
function verdictKo(v: string): string {
  const s = (v || '').toUpperCase();
  if (s.includes('HIGH')) return '위험';
  if (s.includes('SUSPICIOUS')) return '의심';
  if (s.includes('OBSERVE')) return '관찰';
  if (s.includes('NORMAL')) return '정상';
  return v || '—';
}

// category color for signal chips (best-effort grouping by signal name)
function chipColor(sig: string): { bg: string; fg: string } {
  const s = sig.toLowerCase();
  if (/(miner|process|appdata|temp_exec|exec_path|recreation|unknown_process)/.test(s)) {
    return { bg: 'rgba(236,72,153,0.12)', fg: '#be3e80' }; // process = pink
  }
  if (/(net|outbound|exfil|pool|dos|spike|ext|disk_write)/.test(s)) {
    return { bg: 'rgba(59,130,246,0.12)', fg: '#2563eb' }; // network = blue
  }
  if (/(cpu|gpu|vram|mem|power|tensor|flat|sm_high|stealth)/.test(s)) {
    return { bg: 'rgba(124,92,255,0.12)', fg: '#6d4cff' }; // resource = violet
  }
  return { bg: 'rgba(139,145,173,0.12)', fg: C.fgMid }; // context = neutral
}

// ── DataFrame → single record (row 0) ─────────────────────────────
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
const asStr = (v: unknown): string => (v == null ? '' : String(v));
const asNum = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const asBool = (v: unknown): boolean => v === true || v === 't' || v === 'true' || v === 1;
function parseJsonArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  const s = asStr(v).trim();
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p.map(String) : [s];
  } catch {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }
}

const DEMO = {
  verdict: 'HIGH_RISK', severity: 'HIGH', score: 16.8, is_mock: true,
  reason: 'xmrig.exe(known_miner)가 CPU 85%·GPU 90%+를 34분 지속 점유하고 텐서코어는 유휴 상태입니다. 비수업(Free) 슬롯에서 발생해 학습 작업으로 보기 어렵습니다.',
  action: 'xmrig.exe 종료 및 실행 경로 격리 · 사용자 통지',
  signal_quality: 'PARTIAL', explanation_confidence: 'MEDIUM',
  primary_type: 'MINING_SUSPICION', fast_path: 'mining_known', judged_at: '2026-06-10 14:32:07',
  active_signals: '["known_miner","cpu_flat","gpu_flat","tensor_idle","offhours","appdata_exec","net_pool_listen"]',
  expl_reasons: '["signal_quality=PARTIAL","동시간대 peer 비교 가능"]',
  sq_sources: '{"gpu":"PARTIAL","derived":"FULL","network":"PARTIAL"}',
  benign_confidence: '', contradicting_evidence: '',
};

// ── small building blocks ─────────────────────────────────────────
const Badge: React.FC<{ text: string; color: string; outline?: boolean; glow?: boolean }> = ({ text, color, outline, glow }) => (
  <span style={{
    fontFamily: FONT_MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
    padding: '2px 8px', borderRadius: 6,
    color: outline ? color : '#fff',
    background: outline ? 'transparent' : color,
    border: outline ? `1px dashed ${color}` : 'none',
    animation: glow ? 'rada-glow-pulse 2s ease-in-out infinite' : 'none',
    whiteSpace: 'nowrap',
  }}>{text}</span>
);

const ZoneLabel: React.FC<{ tag: string; title: string }> = ({ tag, title }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8 }}>
    <span style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: 700, color: C.fgMuted }}>{tag}</span>
    <span style={{ fontFamily: FONT_UI, fontSize: 12, fontWeight: 600, color: C.fg }}>{title}</span>
  </div>
);

// LOW / MED / HIGH (or FULL/PARTIAL/NONE) segmented stepper
const Stepper: React.FC<{ steps: string[]; active: string; color: string }> = ({ steps, active, color }) => {
  const idx = steps.findIndex((s) => s.toUpperCase() === (active || '').toUpperCase());
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {steps.map((s, i) => (
        <span key={s} style={{
          flex: 1, textAlign: 'center', fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: 600,
          padding: '3px 4px', borderRadius: 4,
          color: i === idx ? '#fff' : C.fgMuted,
          background: i === idx ? color : C.track,
        }}>{s}</span>
      ))}
    </div>
  );
};

export const AIJudgmentPanel: React.FC<Props> = ({ data, options, width, height }) => {
  useEffect(() => { injectSharedStyles(); }, []);

  const live = buildRow(data);
  const g = (field: string, demoKey: keyof typeof DEMO): unknown => {
    if (options.demoMode) return DEMO[demoKey];
    const v = live[field];
    return v === undefined ? '' : v;
  };

  const verdict = asStr(g(options.verdictField, 'verdict'));
  const severity = asStr(g(options.severityField, 'severity'));
  const score = asNum(g(options.scoreField, 'score'));
  const isMock = asBool(g(options.isMockField, 'is_mock'));
  const reason = asStr(g(options.reasonField, 'reason'));
  const action = asStr(g(options.actionField, 'action'));
  const signalQuality = asStr(g(options.signalQualityField, 'signal_quality')) || 'FULL';
  const explConf = asStr(g(options.explConfidenceField, 'explanation_confidence')) || 'MEDIUM';
  const primaryType = asStr(g(options.primaryTypeField, 'primary_type'));
  const fastPath = asStr(g(options.fastPathField, 'fast_path'));
  const judgedAt = asStr(g(options.judgedAtField, 'judged_at'));
  const activeSignals = parseJsonArr(g(options.activeSignalsField, 'active_signals'));
  const explReasons = parseJsonArr(g(options.explReasonsField, 'expl_reasons'));
  const benignConf = asStr(g(options.benignConfidenceField, 'benign_confidence'));
  const contradicting = asStr(g(options.contradictingEvidenceField, 'contradicting_evidence'));

  const accent = sevColor(verdict || severity);
  const confirmed = !!fastPath || /high/i.test(severity);

  return (
    <div style={{
      width, height, boxSizing: 'border-box', overflow: 'hidden',
      background: `linear-gradient(to bottom left, ${C.claude}10, #ffffff 55%)`,
      border: `1px solid ${C.border}`, borderRadius: 16,
      display: 'flex', flexDirection: 'column', fontFamily: FONT_UI,
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 16px 10px', flex: '0 0 auto', flexWrap: 'wrap' }}>
        <span style={{ color: C.claude, fontWeight: 700, fontSize: 14 }}>✳ AI 판단 &amp; 권고 · 신뢰도</span>
        {confirmed && <Badge text="CONFIRMED" color={accent} />}
        <Badge text={isMock ? 'MOCK' : 'REAL'} color={isMock ? C.fgMuted : C.normal} outline={isMock} />
        {fastPath && <Badge text="FAST-PATH" color={C.low} glow />}
        {primaryType && <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.fgMid }}>지배유형 {primaryType}</span>}
        <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 11, color: C.fgMuted }}>
          {judgedAt} {score != null ? `· score ${score.toFixed(1)}` : ''}
        </span>
      </div>

      {/* 4 zones */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 10, padding: '0 12px 12px' }}>
        {/* A — 판단 본문 (dark Claude) */}
        <div style={{ background: `linear-gradient(140deg, ${C.zoneA0}, ${C.zoneA1})`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8 }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: 700, color: 'rgba(246,226,208,0.55)' }}>A</span>
            <span style={{ fontFamily: FONT_UI, fontSize: 12, fontWeight: 600, color: C.zoneAText }}>판단 본문</span>
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 13, lineHeight: 1.55, color: C.zoneAText, fontWeight: 500, overflow: 'auto' }}>
            {reason || '—'}
          </div>
          {activeSignals.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
              {activeSignals.map((s) => {
                const cc = chipColor(s);
                return <span key={s} style={{ fontFamily: FONT_MONO, fontSize: 10, padding: '2px 7px', borderRadius: 5, color: cc.fg, background: cc.bg }}>{s}</span>;
              })}
            </div>
          )}
          {fastPath && (
            <div style={{ marginTop: 'auto', paddingTop: 8, fontFamily: FONT_MONO, fontSize: 10, color: C.zoneAAccent }}>
              게이팅 근거: fast_path · {fastPath} → 즉시 확정 (gating 우회)
            </div>
          )}
        </div>

        {/* B — 신뢰도 */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ZoneLabel tag="B" title="신뢰도 · 수집품질" />
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.fgMuted, marginBottom: 4 }}>수집 품질</div>
            <Stepper steps={['FULL', 'PARTIAL', 'NONE']} active={signalQuality} color={signalQuality === 'FULL' ? C.normal : signalQuality === 'NONE' ? C.high : C.low} />
          </div>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.fgMuted, marginBottom: 4 }}>설명 신뢰도</div>
            <Stepper steps={['LOW', 'MED', 'HIGH']} active={explConf} color={/high/i.test(explConf) ? C.normal : /low/i.test(explConf) ? C.high : C.low} />
          </div>
          {explReasons.length > 0 && (
            <div style={{ fontFamily: FONT_UI, fontSize: 10.5, color: C.fgMid, lineHeight: 1.45 }}>
              {explReasons.map((r) => <div key={r}>· {r}</div>)}
            </div>
          )}
        </div>

        {/* C — 탈앵커링 */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ZoneLabel tag="C" title="탈앵커링 판단" />
          {benignConf || contradicting ? (
            <>
              <div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.fgMuted, marginBottom: 4 }}>benign 신뢰도</div>
                <Stepper steps={['LOW', 'MED', 'HIGH']} active={benignConf} color={/high/i.test(benignConf) ? C.normal : C.high} />
              </div>
              {contradicting && (
                <div style={{ fontFamily: FONT_UI, fontSize: 10.5, color: C.fgMid, lineHeight: 1.45 }}>
                  <span style={{ color: C.fgMuted }}>반대 증거: </span>{contradicting}
                </div>
              )}
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontFamily: FONT_UI, fontSize: 11, color: C.fgMuted, fontStyle: 'italic', lineHeight: 1.5 }}>
              현재 mock · 실 AI 적용 시<br />반대 증거·benign 신뢰도 표시
            </div>
          )}
        </div>

        {/* D — 조치 */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ZoneLabel tag="D" title="조치" />
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: C.fg, lineHeight: 1.5 }}>{action || '—'}</div>
          <div style={{ fontFamily: FONT_UI, fontSize: 10.5, color: C.medium, fontWeight: 600 }}>운영자 승인 필요 · AI 단독 실행 금지</div>
          <button style={{
            marginTop: 'auto', alignSelf: 'flex-start',
            fontFamily: FONT_UI, fontSize: 12, fontWeight: 600, color: '#fff',
            background: C.claude, border: 'none', borderRadius: 9, padding: '7px 13px', cursor: 'pointer',
          }}>운영자 조치 ▶</button>
          <div style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: C.fgMuted }}>게이트: 승인 대기</div>
        </div>
      </div>
    </div>
  );
};
