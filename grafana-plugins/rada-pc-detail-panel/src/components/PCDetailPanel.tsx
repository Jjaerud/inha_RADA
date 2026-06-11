import React, { useEffect, useState } from 'react';
import { PanelProps } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { PCDetailOptions } from '../types';
import { injectSharedStyles } from '../inject';

// ← 메인(허니컴)으로. 현재 시간범위 쿼리는 유지.
function gotoMain(): void {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  try {
    locationService.push(`/d/rada-honeycomb${search}`);
  } catch {
    if (typeof window !== 'undefined') { window.location.assign(`/d/rada-honeycomb${search}`); }
  }
}
import { RADA, gradeFromScore, Ic } from '../theme';
import { TimeSeries } from '../charts';
import { Card, ChartLegend, DeltaChip, StatusCard, GaugeBody, DecisionCard, ScoreSpark, RiskVectorPanel, CompositionPanel, AIUnifiedPanel } from '../widgets';
import { PC_DATA, VRAM_TOTAL_GB } from '../demo';

interface Props extends PanelProps<PCDetailOptions> {}

// ── real-data mapping ──────────────────────────────────────────────
// Query 'meta'  → single field 'panel' (json text) = score/cpu/gpu/mem/online/
//                 scoreSpark/risk/composition/ai
// Query 'ts'    → time series fields cpu/mem/gpu/vram/neti/neto/disk
function findFrame(data: any, fieldName: string): any {
  for (const fr of data.series || []) {
    if (fr.fields.some((f: any) => f.name === fieldName)) return fr;
  }
  return null;
}
function fieldArr(frame: any, name: string): number[] {
  const f = frame?.fields.find((x: any) => x.name === name);
  return f ? Array.from(f.values).map((v: any) => Number(v)) : [];
}
function buildPcFromData(data: any): any | null {
  const metaFrame = findFrame(data, 'panel');
  if (!metaFrame) return null;
  const pf = metaFrame.fields.find((f: any) => f.name === 'panel');
  if (!pf || pf.values.length === 0) return null;
  let panel: any;
  try { panel = typeof pf.values[0] === 'string' ? JSON.parse(pf.values[0]) : pf.values[0]; }
  catch { return null; }
  if (!panel) return null;

  const ts = findFrame(data, 'cpu');
  const series = {
    cpu: fieldArr(ts, 'cpu'), mem: fieldArr(ts, 'mem'), gpu: fieldArr(ts, 'gpu'),
    vramPct: fieldArr(ts, 'vram'), netI: fieldArr(ts, 'neti'), netO: fieldArr(ts, 'neto'),
    disk: fieldArr(ts, 'disk'), vramG: null,
  };
  const lastOf = (a: number[], fb: number) => (a && a.length ? a[a.length - 1] : fb);
  return { id: panel.id || '', online: panel.online !== false, score: panel.score ?? 0,
    cpu: lastOf(series.cpu, panel.cpu ?? 0), gpu: lastOf(series.gpu, panel.gpu ?? 0), mem: lastOf(series.mem, panel.mem ?? 0),
    scoreSpark: panel.scoreSpark || [], risk: panel.risk || [], composition: panel.composition || [],
    ai: panel.ai || {}, series };
}

// Ported PCDetail content area (Sidebar/Topbar dropped — Grafana provides chrome;
// PC selection comes from the dashboard $pc_id variable).
export const PCDetailPanel: React.FC<Props> = ({ data, options, width, height }) => {
  useEffect(() => { injectSharedStyles(); }, []);
  const [cursor, setCursor] = useState<number | null>(null);
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null);

  const realPc = !options.demoMode ? buildPcFromData(data) : null;
  const pc = realPc || PC_DATA[options.demoPc] || PC_DATA['PC-07'];
  const grade = gradeFromScore(pc.score);
  const s = pc.series;
  const pcKey = realPc ? pc.id : options.demoPc;
  useEffect(() => { setExpandOverride(null); setCursor(null); }, [pcKey]);
  const expanded = expandOverride !== null ? expandOverride : grade.sev >= 1;

  const last = (arr: number[]) => (arr && arr.length ? arr[arr.length - 1] : 0);
  const prev = (arr: number[]) => (arr && arr.length > 1 ? arr[arr.length - 2] : 0);
  const vramPct = s.vramPct && s.vramPct.length ? s.vramPct : (s.vramG || []).map((g: number) => (g / VRAM_TOTAL_GB) * 100);

  const chartCard = (icon: string, title: string, subtitle: string, legend: any, delta: any, series: any, yMax: number, thresholds: any) => (
    <Card flat icon={<Ic name={icon} />} title={title} subtitle={subtitle}
      action={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}><ChartLegend items={legend} />{delta}</span>}
      style={{ minHeight: 0 }} bodyStyle={{ padding: '8px 14px 12px', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <TimeSeries series={series} yMax={yMax} thresholds={thresholds} xLabels={['1h', '45m', '30m', '15m', 'now']} height={150} cursor={cursor} onCursor={setCursor} />
    </Card>
  );

  return (
    <div style={{ width, height, overflow: 'auto', background: RADA.bg, color: RADA.fg, fontFamily: RADA.ui, padding: '8px 14px 14px', display: 'flex', flexDirection: 'column', gap: 11, boxSizing: 'border-box' }}>
      {/* ── 헤더: 메인 복귀 + PC ── */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={gotoMain} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 12px', borderRadius: 9, border: `1px solid ${RADA.border}`, background: '#fff', fontFamily: RADA.ui, fontSize: 12.5, fontWeight: 600, color: RADA.fg }}>‹ 메인(허니컴)</button>
        <span style={{ fontFamily: RADA.mono, fontSize: 13, fontWeight: 600, color: RADA.fgMid }}>{pc.id || pcKey}</span>
      </div>

      {/* ── 상단 ── */}
      <div style={{ flex: '0 0 auto', display: 'grid', gridTemplateColumns: '1.3fr 0.82fr 0.82fr 0.82fr 1.05fr 1.4fr', gap: 12, height: 198 }}>
        <Card flat bodyStyle={{ padding: 0, display: 'flex' }}><StatusCard pc={pc} grade={grade} /></Card>
        <Card flat icon={<Ic name="cpu" />} title="CPU" subtitle="현재 점유율" bodyStyle={{ padding: 0, display: 'flex' }}><GaugeBody v={pc.cpu} sub={`피크 ${Math.round(pc.cpu + 6)}%`} kind="cpu" /></Card>
        <Card flat icon={<Ic name="gpu" />} title="GPU" subtitle="현재 점유율" bodyStyle={{ padding: 0, display: 'flex' }}><GaugeBody v={pc.gpu} sub={`피크 ${Math.round(Math.min(99, pc.gpu + 4))}%`} kind="gpu" /></Card>
        <Card flat icon={<Ic name="mem" />} title="MEM" subtitle="시스템 메모리" bodyStyle={{ padding: 0, display: 'flex' }}><GaugeBody v={pc.mem} sub={`피크 ${Math.round(Math.min(99, pc.mem + 5))}%`} kind="mem" /></Card>
        <Card flat icon={<Ic name="score" />} title="등급 / score" bodyStyle={{ padding: 0, display: 'flex' }}><DecisionCard pc={pc} grade={grade} /></Card>
        <Card flat icon={<Ic name="trend" />} title="이상 점수 추이" subtitle="최근 1h · final_score" bodyStyle={{ padding: 0, display: 'flex' }}><ScoreSpark data={pc.scoreSpark} /></Card>
      </div>

      {/* ── 중단: 4 시계열 ── */}
      <div style={{ flex: '0 0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, height: 246 }}>
        {chartCard('chart', '자원 시계열', 'CPU · 시스템 메모리 · 1h',
          [{ label: 'CPU', color: '#0d9488' }, { label: 'MEM', color: '#5eead4' }],
          <DeltaChip prev={prev(s.cpu)} cur={last(s.cpu)} suffix="5s" />,
          [{ name: 'CPU', data: s.cpu, color: '#0d9488', fill: true, width: 2.2, unit: '%' }, { name: 'MEM', data: s.mem, color: '#5eead4', fill: false, width: 2, unit: '%' }],
          100, [{ value: 90, color: RADA.high }])}
        {chartCard('gpu', 'GPU / VRAM 시계열', `GPU util% · VRAM % of ${VRAM_TOTAL_GB}GB`,
          [{ label: 'GPU', color: '#f59e0b' }, { label: 'VRAM', color: '#fcd34d' }],
          <DeltaChip prev={prev(s.gpu)} cur={last(s.gpu)} suffix="5s" />,
          [{ name: 'GPU', data: s.gpu, color: '#f59e0b', fill: true, width: 2.2, unit: '%' }, { name: 'VRAM', data: vramPct, color: '#fcd34d', fill: false, width: 2, unit: '%' }],
          100, [{ value: 90, color: RADA.high }])}
        {chartCard('net', '네트워크 시계열', '수신 · 송신 · Mbps · 1h',
          [{ label: '수신', color: RADA.blue }, { label: '송신', color: RADA.cyan }],
          <DeltaChip prev={prev(s.netI)} cur={last(s.netI)} suffix="5s" />,
          [{ name: '수신', data: s.netI, color: RADA.blue, fill: true, fillOpacity: 0.16, width: 2, unit: ' Mbps' }, { name: '송신', data: s.netO, color: RADA.cyan, fill: false, width: 1.8, unit: ' Mbps' }],
          40, [])}
        {chartCard('disk', '디스크 시계열', '읽기·쓰기 · MB/s · 1h',
          [{ label: '디스크', color: RADA.primary }],
          <DeltaChip prev={prev(s.disk)} cur={last(s.disk)} suffix="5s" />,
          [{ name: '디스크', data: s.disk, color: RADA.primary, fill: true, fillOpacity: 0.16, width: 2, unit: ' MB/s', fmt: (v: number) => v.toFixed(1) }],
          30, [])}
      </div>

      {/* ── 하단 ── */}
      {!expanded ? (
        <div style={{ flex: '1 1 0', display: 'flex', alignItems: 'flex-start', minHeight: 240 }}>
          <button onClick={() => setExpandOverride(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '14px 22px', borderRadius: 14, border: `1px dashed ${RADA.border}`, background: '#fff', fontFamily: RADA.ui, color: RADA.fg, textAlign: 'left' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, background: `${RADA.normal}16`, color: RADA.normal }}><Ic name="check" size={16} /></span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>정상 · 상세 분석 패널 접힘</span>
            <span style={{ fontSize: 12, color: RADA.fgMuted }}>점수 구성 · risk vector · AI 판단&권고 — 이상 발생 시 자동 펼침</span>
            <span style={{ marginLeft: 'auto', fontSize: 12.5, color: RADA.primary, fontWeight: 600 }}>지금 펼치기 ▾</span>
          </button>
        </div>
      ) : (
        <div style={{ flex: '1 1 0', display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 12, minHeight: 300 }}>
          <Card flat icon={<Ic name="claude" color="#c9613f" />} title="AI 판단 & 권고 + 신뢰도" subtitle="ai_judgment · 신뢰도 · 탈앵커링 · 조치"
            style={{ minHeight: 0, background: 'linear-gradient(to bottom left, #f6cfba 0%, #fbe6da 46%, #fefbf8 100%)' }} bodyStyle={{ padding: 0, minHeight: 0, display: 'flex', background: 'transparent' }}>
            <AIUnifiedPanel ai={pc.ai} />
          </Card>
          <Card flat icon={<Ic name="risk" />} title="risk vector" subtitle="위험 유형 5축 · 높은 순" style={{ minHeight: 0 }} bodyStyle={{ padding: 0, minHeight: 0, display: 'flex' }}>
            <RiskVectorPanel data={pc.risk} />
          </Card>
          <Card flat icon={<Ic name="score" />} title="점수 구성 비중" subtitle="기여도 기준 · 최신 이상 점수"
            action={<button onClick={() => setExpandOverride(false)} style={{ cursor: 'pointer', padding: '3px 9px', borderRadius: 7, border: `1px solid ${RADA.border}`, background: '#fff', fontFamily: RADA.ui, fontSize: 11.5, fontWeight: 600, color: RADA.fgMid }}>접기 ▴</button>}
            style={{ minHeight: 0 }} bodyStyle={{ padding: 0, minHeight: 0, display: 'flex' }}>
            <CompositionPanel data={pc.composition} />
          </Card>
        </div>
      )}
    </div>
  );
};
