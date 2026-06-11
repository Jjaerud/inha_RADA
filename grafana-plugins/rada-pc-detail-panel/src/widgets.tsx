import React from 'react';
import { RADA, SCORE_MAX, BANDS, gradeFromScore, gColor, sevGlyph, zoneColor, smoothD, Ic } from './theme';

// ── Card (ported from panels.jsx, flat variant) ───────────────────
export function Card({ title, subtitle, children, style, bodyStyle, action, flat, icon }: any) {
  return (
    <div style={{ background: RADA.panel, borderRadius: flat ? 14 : 18, border: `1px solid ${RADA.border}`, boxShadow: '0 1px 2px rgba(15,20,50,0.04)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', ...style }}>
      {(title || action || icon) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: flat ? '9px 18px 5px' : '18px 22px 12px', flex: '0 0 auto', position: 'relative' }}>
          {icon && <div style={{ flex: '0 0 auto', color: RADA.fgMid, marginTop: 1 }}>{icon}</div>}
          {title && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div style={{ fontFamily: RADA.ui, fontSize: 15, fontWeight: 600, color: RADA.fg, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{title}</div>
              {subtitle && <div style={{ fontFamily: RADA.ui, fontSize: flat ? 11 : 12, color: flat ? RADA.fgMid : RADA.fgMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>}
            </div>
          )}
          {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
        </div>
      )}
      <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative', ...bodyStyle }}>{children}</div>
    </div>
  );
}

// ── BlobGauge (ported from panels.jsx) ─────────────────────────────
export function BlobGauge({ value, unit = '%', label, size = 200, palette }: any) {
  const cx = size / 2, cy = size / 2;
  const lobeR = size * 0.27;
  const lobes = (palette || [
    { angle: 270, color: '#6d4cff' }, { angle: 330, color: '#00c4d4' }, { angle: 30, color: '#00b574' },
    { angle: 90, color: '#f5588c' }, { angle: 150, color: '#a78bfa' }, { angle: 210, color: '#3b82f6' },
  ]).map((l: any) => {
    const a = l.angle * Math.PI / 180;
    return { ...l, cx: cx + Math.cos(a) * size * 0.18, cy: cy + Math.sin(a) * size * 0.18 };
  });
  const filterId = `blob-blur-${size}`;
  const centerR = size * 0.36;
  return (
    <div style={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
        <defs><filter id={filterId} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={size * 0.05} /></filter></defs>
        <g filter={`url(#${filterId})`} style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'rada-blob-rotate-ccw 28s linear infinite', opacity: 0.55 }}>
          {lobes.map((l: any, i: number) => { const a = (l.angle * Math.PI / 180); return <circle key={`o-${i}`} cx={cx + Math.cos(a) * size * 0.27} cy={cy + Math.sin(a) * size * 0.27} r={lobeR * 1.1} fill={l.color} opacity={0.9} />; })}
        </g>
        <g filter={`url(#${filterId})`} style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'rada-blob-rotate-cw 18s linear infinite' }}>
          {lobes.map((l: any, i: number) => <circle key={i} cx={l.cx} cy={l.cy} r={lobeR} fill={l.color} opacity={0.95} />)}
        </g>
        <circle cx={cx} cy={cy} r={centerR} fill={RADA.bgDeep} />
        <circle cx={cx} cy={cy} r={centerR} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        {label && <span style={{ fontFamily: RADA.ui, fontSize: size * 0.055, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: size * 0.02, fontWeight: 500 }}>{label}</span>}
        <span style={{ fontFamily: RADA.ui, fontSize: size * 0.21, fontWeight: 700, color: '#fff', letterSpacing: '-0.04em', lineHeight: 1 }}>{value}<span style={{ fontSize: size * 0.085, color: 'rgba(255,255,255,0.6)', fontWeight: 500, marginLeft: 2 }}>{unit}</span></span>
      </div>
    </div>
  );
}

// ── badges / chips ─────────────────────────────────────────────────
export function GradeBadge({ grade, sev, size = 10 }: any) {
  const c = gColor(sev);
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 5, background: `${c}1f`, color: c, fontFamily: RADA.ui, fontSize: size, fontWeight: 700, letterSpacing: '0.05em' }}><span style={{ fontSize: size * 0.85 }}>{sevGlyph(sev)}</span>{grade}</span>;
}
export function MockBadge() {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 5, border: `1px dashed ${RADA.fgMuted}99`, color: RADA.fgMuted, fontFamily: RADA.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em' }}>○ MOCK</span>;
}
export function Pill({ children, tone, dash }: any) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 5, border: `1px ${dash ? 'dashed' : 'solid'} ${tone}55`, background: `${tone}10`, color: tone, fontFamily: RADA.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em' }}>{children}</span>;
}
export function EmptyState({ title, sub, ok = true }: any) {
  const c = ok ? RADA.normal : RADA.fgMuted;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, height: '100%', width: '100%', padding: '12px 18px', textAlign: 'center' }}>
      <div style={{ width: 34, height: 34, borderRadius: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${c}14`, color: c }}><Ic name={ok ? 'check' : 'clock'} size={18} /></div>
      <span style={{ fontFamily: RADA.ui, fontSize: 12.5, color: RADA.fgMid, fontWeight: 600 }}>{title}</span>
      {sub && <span style={{ fontFamily: RADA.ui, fontSize: 10.5, color: RADA.fgMuted, lineHeight: 1.4 }}>{sub}</span>}
    </div>
  );
}
export function DeltaChip({ prev, cur, suffix = '' }: any) {
  const d = cur - prev;
  const pct = prev !== 0 ? (d / Math.abs(prev)) * 100 : 0;
  const flat = Math.abs(pct) < 0.6;
  const up = d > 0;
  const col = flat ? RADA.fgMuted : up ? RADA.high : RADA.normal;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: RADA.mono, fontSize: 11, fontWeight: 700, color: col }}><span style={{ fontSize: 9 }}>{flat ? '▬' : up ? '▲' : '▼'}</span>{Math.abs(pct).toFixed(1)}%{suffix && <span style={{ color: RADA.fgMuted, fontWeight: 500, fontSize: 9.5 }}>{suffix}</span>}</span>;
}
export function ChartLegend({ items }: any) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>{items.map((it: any) => <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: RADA.ui, fontSize: 11, color: RADA.fgMuted, fontWeight: 500 }}><span style={{ width: 12, height: 2.5, borderRadius: 2, background: it.color }} />{it.label}</span>)}</span>;
}

// ── StatusCard (블롭 + 위험/의심/정상) ─────────────────────────────
const SEV_PALETTE: Record<number, string[]> = {
  0: ['#00b574', '#10b981', '#34d399', '#22c55e', '#16a34a', '#00c4a7'],
  1: ['#f5a623', '#fbbf24', '#fcd34d', '#f59e0b', '#eab308', '#fde047'],
  2: ['#ff7849', '#fb923c', '#f97316', '#fdba74', '#ea580c', '#ff8a5c'],
  3: ['#f43f5e', '#f5588c', '#fb7185', '#e11d48', '#dc2626', '#ff4d6d'],
};
function sevPalette(sev: number) {
  const cols = SEV_PALETTE[sev] || SEV_PALETTE[0];
  const angles = [270, 330, 30, 90, 150, 210];
  return angles.map((angle, i) => ({ angle, color: cols[i] }));
}
function makeStars(n: number, seed: number) {
  const out: any[] = []; let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < n; i++) out.push({ x: rnd() * 100, y: rnd() * 100, r: 0.5 + rnd() * 1.5, o: 0.3 + rnd() * 0.6, dur: 2.4 + rnd() * 3.4, delay: rnd() * 4, dx: (rnd() * 2 - 1) * 3.5, dy: (rnd() * 2 - 1) * 3.5 });
  return out;
}
const STARS = makeStars(20, 7321);
export function StatusCard({ pc, grade }: any) {
  const c = gColor(grade.sev);
  const word = grade.sev >= 3 ? '위험' : grade.sev >= 1 ? '의심' : '정상';
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '100%', width: '100%', padding: '14px 20px', gap: 14, background: '#090d1e', overflow: 'hidden' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {STARS.map((st, i) => (
          <circle key={i} cx={`${st.x}%`} cy={`${st.y}%`} r={st.r} fill="#fff" opacity={st.o}>
            <animate attributeName="opacity" values={`${st.o};${(st.o * 0.2).toFixed(2)};${st.o}`} dur={`${st.dur}s`} begin={`${st.delay}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </svg>
      <div style={{ position: 'relative', zIndex: 1, flex: '0 0 auto' }}>
        <BlobGauge value={pc.id} unit="" label="장비" size={118} palette={sevPalette(grade.sev)} />
      </div>
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: RADA.ui, fontSize: 10.5, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>PC 상태</span>
        <span style={{ fontFamily: RADA.ui, fontSize: 26, fontWeight: 700, color: c, letterSpacing: '-0.02em', lineHeight: 1 }}>{word}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ color: c, fontSize: 9 }}>{sevGlyph(grade.sev)}</span>
          <span style={{ fontFamily: RADA.mono, fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 700, letterSpacing: '0.05em' }}>{grade.key}</span>
          <span style={{ width: 5, height: 5, borderRadius: 5, background: pc.online ? RADA.normal : RADA.fgMuted, marginLeft: 3 }} />
          <span style={{ fontFamily: RADA.ui, fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>{pc.online ? 'ONLINE' : 'OFFLINE'}</span>
        </span>
      </div>
    </div>
  );
}

// ── needle gauge ───────────────────────────────────────────────────
export function RefGauge({ value, kind, sub }: any) {
  const col = zoneColor(value, kind);
  const size = 152, cx = size / 2, cy = size * 0.52, r = size * 0.42, th = 12;
  const A0 = Math.PI, A1 = 2 * Math.PI;
  const ang = (v: number) => A0 + (Math.min(Math.max(v, 0), 100) / 100) * (A1 - A0);
  const pt = (aa: number, rr: number) => [cx + rr * Math.cos(aa), cy + rr * Math.sin(aa)];
  const arc = (a0: number, a1: number, rr: number) => { const [x0, y0] = pt(a0, rr), [x1, y1] = pt(a1, rr); const large = (a1 - a0) > Math.PI ? 1 : 0; return `M${x0.toFixed(1)},${y0.toFixed(1)} A${rr},${rr} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
  const va = ang(value);
  const N = 30; const segs: any[] = [];
  for (let i = 0; i < N; i++) { const a0 = A0 + (i / N) * (va - A0), a1 = A0 + ((i + 1) / N) * (va - A0); segs.push({ d: arc(a0, a1, r), op: 0.14 + 0.86 * (i / (N - 1)) }); }
  const [tx, ty] = pt(va, r * 0.9);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <svg width={size} height={cy + 9} viewBox={`0 0 ${size} ${cy + 9}`} style={{ overflow: 'visible' }}>
        <path d={arc(A0, A1, r)} fill="none" stroke="#edeff6" strokeWidth={th} strokeLinecap="round" />
        {segs.map((s, i) => <path key={i} d={s.d} fill="none" stroke={col} strokeOpacity={s.op} strokeWidth={th} strokeLinecap={i === N - 1 ? 'round' : 'butt'} />)}
        <line x1={cx} y1={cy} x2={tx} y2={ty} stroke={RADA.fg} strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={4.5} fill={RADA.fg} />
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', width: '88%', background: 'linear-gradient(145deg, rgba(214,219,235,0.78), rgba(188,195,220,0.6))', backdropFilter: 'blur(7px)', WebkitBackdropFilter: 'blur(7px)', border: '1px solid rgba(255,255,255,0.65)', borderRadius: 11, padding: '5px 12px', marginTop: 4, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.75), 0 5px 14px rgba(20,24,60,0.1)' }}>
        <span style={{ fontFamily: RADA.mono, fontSize: 9.5, color: RADA.fgMid, justifySelf: 'start' }}>0</span>
        <span style={{ fontFamily: RADA.ui, fontSize: 26, fontWeight: 700, color: col, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', justifySelf: 'center' }}>{Math.round(value)}<span style={{ fontSize: 12, color: RADA.fgMid, fontWeight: 500, marginLeft: 1 }}>%</span></span>
        <span style={{ fontFamily: RADA.mono, fontSize: 9.5, color: RADA.fgMid, justifySelf: 'end' }}>100</span>
      </div>
      {sub && <span style={{ fontFamily: RADA.ui, fontSize: 9.5, color: RADA.fgMuted, marginTop: 3 }}>{sub}</span>}
    </div>
  );
}
export function GaugeBody({ v, kind, sub }: any) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', padding: '2px 6px 8px' }}><RefGauge value={v} kind={kind} sub={sub} /></div>;
}

// ── 등급 / score ───────────────────────────────────────────────────
export function DecisionCard({ pc, grade }: any) {
  const uid = React.useId().replace(/[:]/g, '');
  const c = gColor(grade.sev);
  const ticks = [BANDS.OBSERVE, BANDS.SUSPICIOUS, BANDS.HIGH_RISK];
  const sc = Math.min(pc.score, SCORE_MAX);
  const bands = [{ from: 0, to: 5, color: RADA.normal }, { from: 5, to: 9, color: RADA.low }, { from: 9, to: 14, color: RADA.medium }, { from: 14, to: 20, color: RADA.high }];
  const legend = [['정상', RADA.normal], ['관찰', RADA.low], ['의심', RADA.medium], ['위험', RADA.high]];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 20px', height: '100%', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: RADA.ui, fontSize: 42, fontWeight: 700, color: c, letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{sc.toFixed(1)}</span>
        <span style={{ fontFamily: RADA.ui, fontSize: 15, fontWeight: 500, color: RADA.fgMuted }}>/ 20</span>
      </div>
      <div>
        <svg width="100%" height={18} style={{ display: 'block', overflow: 'visible' }}>
          <defs><clipPath id={`db-${uid}`}><rect x={0} y={3} width="100%" height={11} rx={5.5} /></clipPath></defs>
          <g clipPath={`url(#db-${uid})`}>{bands.map((b, i) => <rect key={i} x={`${(b.from / SCORE_MAX) * 100}%`} y={3} width={`${((b.to - b.from) / SCORE_MAX) * 100}%`} height={11} fill={b.color} fillOpacity={0.3} />)}</g>
          <circle cx={`${(sc / SCORE_MAX) * 100}%`} cy={8.5} r={6.5} fill="#fff" stroke={c} strokeWidth={3} />
        </svg>
        <div style={{ position: 'relative', height: 11, marginTop: 4 }}>
          {ticks.map(t => <span key={t} style={{ position: 'absolute', left: `${(t / SCORE_MAX) * 100}%`, transform: 'translateX(-50%)', fontFamily: RADA.mono, fontSize: 9, color: RADA.fgMuted }}>{t}</span>)}
          <span style={{ position: 'absolute', right: 0, fontFamily: RADA.mono, fontSize: 9, color: RADA.fgMuted }}>20</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {legend.map(l => <span key={l[0]} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: RADA.ui, fontSize: 10.5, color: RADA.fgMuted, fontWeight: 500 }}><span style={{ width: 8, height: 8, borderRadius: 8, background: l[1] }} />{l[0]}</span>)}
      </div>
    </div>
  );
}

// ── 이상 점수 추이 ─────────────────────────────────────────────────
export function ScoreSpark({ data }: any) {
  const uid = React.useId().replace(/[:]/g, '');
  if (!data || data.length < 2) return <EmptyState title="최근 이상 없음" sub="MEDIUM+ 이벤트 없음" />;
  const cur = data[data.length - 1], prev = data[data.length - 2];
  const g = gradeFromScore(cur), c = g.sev === 0 ? RADA.normal : RADA.high;
  const W = 300, H = 110, padX = 6, padTop = 8, padBot = 4;
  const iw = W - padX * 2, ih = H - padTop - padBot, N = data.length;
  const xs = (i: number) => padX + (i / (N - 1)) * iw;
  const ys = (v: number) => padTop + ih - (Math.min(v, SCORE_MAX) / SCORE_MAX) * ih;
  const pts = data.map((v: number, i: number) => [xs(i), ys(v)]);
  const line = smoothD(pts);
  const area = `${line} L${xs(N - 1)},${ys(0)} L${xs(0)},${ys(0)} Z`;
  const lx = xs(N - 1), ly = ys(cur);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '4px 16px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: RADA.ui, fontSize: 30, fontWeight: 700, color: c, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{cur.toFixed(1)}</span>
        <span style={{ fontFamily: RADA.ui, fontSize: 13, color: RADA.fgMuted }}>/ 20</span>
        <span style={{ marginLeft: 'auto' }}><DeltaChip prev={prev} cur={cur} suffix="5s" /></span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
          <defs><linearGradient id={`ss-${uid}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity={0.24} /><stop offset="100%" stopColor={c} stopOpacity={0} /></linearGradient></defs>
          <line x1={padX} x2={W - padX} y1={ys(BANDS.HIGH_RISK)} y2={ys(BANDS.HIGH_RISK)} stroke={RADA.high} strokeDasharray="4 3" strokeOpacity={0.45} strokeWidth={1} />
          <path d={area} fill={`url(#ss-${uid})`} />
          <path d={line} fill="none" stroke={c} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
          <line x1={lx} x2={lx} y1={ly} y2={padTop + ih} stroke={c} strokeOpacity={0.35} strokeWidth={1.2} />
          <circle cx={lx} cy={ly} r={4.6} fill={c} stroke="#fff" strokeWidth={2} />
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: RADA.mono, fontSize: 9, color: RADA.fgMuted, paddingTop: 2 }}><span>-1h</span><span>-30m</span><span>now</span></div>
    </div>
  );
}

// ── risk vector (radar + list) ─────────────────────────────────────
const RISK_DESC: Record<string, string> = { '채굴': 'GPU 지속 점유 · known_miner 시그니처', '망 남용': '외부 풀 연결 · 비정상 송수신량', '위협': '의심 프로세스 · 접근 이상 패턴', '노후화': 'HW 성능 저하 · 온도·오류 추세', '오작동': '비정상 종료 · 에러 빈도 상승' };
const RISK_ICON: Record<string, string> = { '채굴': 'gpu', '망 남용': 'net', '위협': 'risk', '노후화': 'clock', '오작동': 'alert' };
const CMP_ICON: Record<string, string> = { '리소스': 'cpu', '프로세스': 'chart', 'ML': 'ai', '에피소드': 'clock', '상관': 'trend', '네트워크': 'net' };

function RadarChart({ data, size = 152, dark = false }: any) {
  const uid = React.useId().replace(/[:]/g, '');
  const domIdx = data.reduce((m: number, d: any, i: number, a: any[]) => d.value > a[m].value ? i : m, 0);
  const active = data[domIdx].value >= 0.2;
  const gridStroke = dark ? 'rgba(255,255,255,0.13)' : '#e2e5f1';
  const ringLbl = dark ? 'rgba(255,255,255,0.38)' : RADA.fgMuted;
  const axisLbl = dark ? 'rgba(255,255,255,0.72)' : RADA.fgMid;
  const dotStroke = dark ? '#1a1030' : '#fff';
  const S = size, cx = S / 2, cy = S / 2, R = S * (dark ? 0.32 : 0.36), n = data.length;
  const ang = (i: number) => (-90 + i * (360 / n)) * Math.PI / 180;
  const pt = (i: number, r: number) => [cx + Math.cos(ang(i)) * R * r, cy + Math.sin(ang(i)) * R * r];
  const rings = [{ r: 1, l: '100' }, { r: 0.66, l: '66' }, { r: 0.33, l: '33' }];
  const poly = data.map((d: any, i: number) => pt(i, Math.max(d.value, 0.012)).map((x: number) => x.toFixed(1)).join(',')).join(' ');
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ overflow: 'visible', flex: '0 0 auto' }}>
      <defs><linearGradient id={`rg-${uid}`} x1="1" y1="0.1" x2="0.1" y2="1"><stop offset="0%" stopColor="#ff6b78" /><stop offset="100%" stopColor="#d61f3c" /></linearGradient></defs>
      {rings.map((rg, ri) => <polygon key={ri} points={data.map((_: any, i: number) => pt(i, rg.r).map((x: number) => x.toFixed(1)).join(',')).join(' ')} fill="none" stroke={gridStroke} strokeWidth={1} />)}
      {data.map((_: any, i: number) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={gridStroke} strokeWidth={1} />; })}
      {rings.map((rg, ri) => { const [x, y] = pt(0, rg.r); return <text key={'l' + ri} x={x + 6} y={y + 3} style={{ fontFamily: RADA.mono, fontSize: 8.5, fill: ringLbl }}>{rg.l}</text>; })}
      <polygon points={poly} fill={`url(#rg-${uid})`} fillOpacity={dark ? 0.82 : (active ? 0.72 : 0.12)} stroke={'#e11d3f'} strokeWidth={2} strokeLinejoin="round" />
      {data.map((d: any, i: number) => { const [x, y] = pt(i, Math.max(d.value, 0.012)); const isD = i === domIdx && active; return <circle key={i} cx={x} cy={y} r={isD ? 4 : 2.6} fill={isD ? '#e11d3f' : (dark ? '#ffd2d8' : RADA.fgMuted)} stroke={dotStroke} strokeWidth={1.4} />; })}
      {data.map((d: any, i: number) => { const [x, y] = pt(i, 1.2); const isDom = i === domIdx && active; return <text key={'a' + i} x={x} y={y + 3} textAnchor="middle" style={{ fontFamily: RADA.ui, fontSize: 9.5, fontWeight: isDom ? 700 : 500, fill: isDom ? '#e11d3f' : axisLbl }}>{d.axis} <tspan style={{ fontFamily: RADA.mono, fontWeight: 700, fill: isDom ? '#e11d3f' : ringLbl }}>{Math.round(d.value * 100)}</tspan></text>; })}
    </svg>
  );
}
export function RiskVectorPanel({ data }: any) {
  const sorted = data.map((d: any, i: number) => ({ ...d, i })).sort((a: any, b: any) => b.value - a.value);
  const topActive = sorted[0].value >= 0.2;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minHeight: 0 }}>
      <div style={{ flex: '0 0 auto', margin: '8px 14px 4px', borderRadius: 14, background: 'linear-gradient(160deg, #2b3146 0%, #20253566 100%), #262c3d', border: '1px solid #333a52', padding: '8px 6px 4px', display: 'flex', justifyContent: 'center' }}>
        <RadarChart data={data} size={152} dark />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 14px 10px', justifyContent: 'space-between' }}>
        {sorted.map((d: any, k: number) => {
          const isTop = k === 0 && topActive;
          const col = isTop ? RADA.high : RADA.fgMid;
          return (
            <div key={d.axis} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '28px 1fr auto', alignItems: 'center', gap: 10, padding: '5px 10px', borderRadius: 11, flex: '1 1 0', minHeight: 0, background: isTop ? `${RADA.high}0d` : RADA.panelHi, border: `1px solid ${isTop ? RADA.high + '33' : RADA.border}`, boxShadow: isTop ? `0 6px 16px ${RADA.high}1e` : 'none' }}>
              {isTop && <div className="rada-glow-breathe" style={{ position: 'absolute', inset: -1, borderRadius: 12, boxShadow: `0 0 0 2px ${RADA.high}, 0 0 15px 1px ${RADA.high}`, pointerEvents: 'none' }} />}
              <span style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isTop ? `${RADA.high}1a` : '#fff', border: `1px solid ${isTop ? RADA.high + '33' : RADA.border}`, color: col, flex: '0 0 auto' }}><Ic name={RISK_ICON[d.axis] || 'risk'} size={15} /></span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontFamily: RADA.ui, fontSize: 12, fontWeight: isTop ? 700 : 600, color: isTop ? col : RADA.fg }}>{d.axis}</span>
                <span style={{ fontFamily: RADA.ui, fontSize: 10, color: RADA.fgMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{RISK_DESC[d.axis]}</span>
              </div>
              <span style={{ fontFamily: RADA.mono, fontSize: 14, fontWeight: 700, color: col, fontVariantNumeric: 'tabular-nums' }}>{Math.round(d.value * 100)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 점수 구성 비중 ─────────────────────────────────────────────────
export function CompositionPanel({ data }: any) {
  const sum = data.reduce((s: number, d: any) => s + d.pct, 0);
  const zero = sum === 0;
  const sorted = [...data].sort((a: any, b: any) => b.pct - a.pct);
  const maxV = Math.max(sorted[0].pct, 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', padding: '8px 16px 12px', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flex: '0 0 auto', paddingBottom: 6, borderBottom: `1px solid ${RADA.border}` }}>
        <span style={{ fontFamily: RADA.ui, fontSize: 11, color: RADA.fgMuted, fontWeight: 600 }}>{zero ? '기여 신호 없음 · 정상 베이스라인' : '기여 비중 합'}</span>
        <span style={{ fontFamily: RADA.mono, fontSize: 15, color: zero ? RADA.normal : RADA.fg, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{sum}%</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 5, justifyContent: 'space-between' }}>
        {sorted.map((r: any, k: number) => {
          const isTop = k === 0 && !zero;
          const c = zero ? '#c7ccde' : r.flat;
          return (
            <div key={r.k} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '32px 1fr 44px', alignItems: 'center', gap: 11, padding: '6px 10px', borderRadius: 11, flex: '1 1 0', minHeight: 0, background: isTop ? `${c}12` : RADA.panelHi, border: `1px solid ${isTop ? c + '40' : RADA.border}`, boxShadow: isTop ? `0 6px 16px ${c}1e` : 'none' }}>
              {isTop && <div className="rada-glow-breathe" style={{ position: 'absolute', inset: -1, borderRadius: 12, boxShadow: `0 0 0 2px ${c}, 0 0 15px 1px ${c}`, pointerEvents: 'none' }} />}
              <span style={{ width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isTop ? c : `${c}1c`, color: isTop ? '#fff' : c, flex: '0 0 auto' }}><Ic name={CMP_ICON[r.k] || 'chart'} size={16} /></span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontFamily: RADA.ui, fontSize: 11.5, fontWeight: isTop ? 700 : 600, color: isTop ? c : RADA.fg }}>{r.k}</span>
                <div style={{ position: 'relative', width: '100%', height: 7, borderRadius: 3.5, background: '#e7eaf3', overflow: 'hidden' }}>
                  {!zero && <div className="rada-bar-flow" style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${(r.pct / maxV) * 100}%`, borderRadius: 3.5, backgroundImage: `linear-gradient(90deg, ${c}, color-mix(in srgb, ${c} 60%, #15102a), ${c})`, backgroundSize: '200% 100%' }} />}
                </div>
              </div>
              <span style={{ fontFamily: RADA.ui, fontSize: 15, color: isTop ? c : RADA.fg, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{r.pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── AI 4-zone ──────────────────────────────────────────────────────
export function AIUnifiedPanel({ ai }: any) {
  const c = gColor(ai.sev);
  if (ai.sev === 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', gap: 10, padding: 24, textAlign: 'center' }}>
      <div style={{ width: 50, height: 50, borderRadius: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${RADA.normal}16`, color: RADA.normal }}><Ic name="check" size={28} /></div>
      <span style={{ fontFamily: RADA.ui, fontSize: 17, fontWeight: 700, color: RADA.normal }}>정상 · 이상 징후 없음</span>
      <span style={{ fontFamily: RADA.ui, fontSize: 12.5, color: RADA.fgMuted }}>모든 신호 베이스라인 · AI 판단 결과 조치 불필요</span>
      <span style={{ fontFamily: RADA.mono, fontSize: 10.5, color: RADA.fgDim }}>판단 {ai.at}</span>
    </div>
  );
  const Tag = ({ tone, children }: any) => <span style={{ fontFamily: RADA.mono, fontSize: 10, fontWeight: 700, color: tone, background: `${tone}18`, borderRadius: 4, padding: '1px 6px', letterSpacing: '0.04em' }}>{children}</span>;
  const ZoneCard = ({ tag, title, flex, children }: any) => (
    <div style={{ flex: `${flex} 1 0`, minHeight: 0, background: 'rgba(255,255,255,0.86)', border: '1px solid rgba(255,255,255,0.7)', borderRadius: 11, padding: '7px 13px 8px', display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden', boxShadow: '0 2px 8px rgba(120,60,30,0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 16, height: 16, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: `1px solid ${RADA.border}`, fontFamily: RADA.mono, fontSize: 9, fontWeight: 700, color: RADA.fgMid }}>{tag}</span>
        <span style={{ fontFamily: RADA.ui, fontSize: 11.5, fontWeight: 700, color: RADA.fg }}>{title}</span>
      </div>
      {children}
    </div>
  );
  const FL = ({ label, children }: any) => (
    <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
      <span style={{ fontFamily: RADA.ui, fontSize: 10.5, color: RADA.fgMuted, flex: '0 0 88px' }}>{label}</span>
      <div style={{ fontFamily: RADA.ui, fontSize: 11, color: RADA.fg, lineHeight: 1.35, flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
  const ql = ai.quality.level === 'FULL' ? RADA.normal : RADA.medium;
  const el = ai.explain.level === 'HIGH' ? RADA.normal : ai.explain.level === 'MED' ? RADA.medium : RADA.fgMuted;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', padding: '4px 16px 12px', minHeight: 0, gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', flex: '0 0 auto' }}>
        <GradeBadge grade={ai.grade} sev={ai.sev} size={11} />
        {ai.mock ? <MockBadge /> : <Pill tone={RADA.normal}>● REAL</Pill>}
        {ai.fast
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 5, background: '#fbbf2426', color: '#9a6b00', border: '1px solid #f5b50077', fontFamily: RADA.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', boxShadow: '0 0 0 3px rgba(245,181,0,0.2), 0 0 12px rgba(245,181,0,0.55)' }}>⚡ FAST-PATH</span>
          : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 5, border: `1px dashed ${RADA.fgMuted}99`, color: RADA.fgMuted, fontFamily: RADA.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em' }}>○ FAST-PATH</span>}
        <span style={{ fontFamily: RADA.ui, fontSize: 12, color: RADA.fgMid }}>지배유형 <strong style={{ color: c }}>{ai.primaryType}</strong></span>
        <span style={{ marginLeft: 'auto', fontFamily: RADA.mono, fontSize: 11, color: RADA.fgMuted }}>판단 {ai.at}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minHeight: 0 }}>
        <div style={{ flex: '1.85 1 0', minHeight: 0, background: 'linear-gradient(140deg, #2d1e15 0%, #16100b 100%)', borderRadius: 11, padding: '9px 14px 10px', display: 'flex', flexDirection: 'column', gap: 7, overflow: 'hidden', boxShadow: '0 5px 16px rgba(60,28,10,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 16, height: 16, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(232,168,124,0.16)', border: '1px solid rgba(232,168,124,0.4)', fontFamily: RADA.mono, fontSize: 9, fontWeight: 700, color: '#e8a87c' }}>A</span>
            <span style={{ fontFamily: RADA.ui, fontSize: 12, fontWeight: 700, color: '#e8a87c' }}>판단 본문</span>
          </div>
          <div style={{ fontFamily: RADA.ui, fontSize: 14, color: '#f6e2d0', lineHeight: 1.5, fontWeight: 600 }}>{ai.reason}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto' }}>{ai.signals.slice(0, 6).map((s: string) => <span key={s} style={{ fontFamily: RADA.mono, fontSize: 9.5, color: '#e8cdb6', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 5, padding: '2px 7px' }}>{s}</span>)}{ai.signals.length > 6 && <span style={{ fontFamily: RADA.mono, fontSize: 9.5, color: '#e8cdb6', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 5, padding: '2px 7px' }}>+{ai.signals.length - 6}</span>}</div>
        </div>
        <ZoneCard tag="B" title="신뢰도 · 수집품질" flex={1.02}>
          <FL label="수집 품질"><Tag tone={ql}>{ai.quality.level}</Tag> <span style={{ color: RADA.fgMuted }}>저하원 {ai.quality.degraded}</span></FL>
          <FL label="설명 신뢰도"><Tag tone={el}>{ai.explain.level}</Tag> {ai.explain.basis}</FL>
          <FL label="데이터 신선도">결측 {ai.freshness.missing} · 지연 {ai.freshness.delay} · 수집 {ai.freshness.lastSeen}</FL>
        </ZoneCard>
        <ZoneCard tag="C" title="탈앵커링 판단" flex={1}>
          <FL label="반대 증거">{ai.contradicting}</FL>
          <FL label="benign 신뢰도">{ai.benign}</FL>
          <span style={{ fontFamily: RADA.ui, fontSize: 9.5, color: RADA.fgMuted, fontStyle: 'italic' }}>현재 mock · 실 AI 적용 시 반대근거·재평가 자동 표시</span>
        </ZoneCard>
        <ZoneCard tag="D" title="조치" flex={1}>
          <div style={{ fontFamily: RADA.ui, fontSize: 11, color: RADA.fg, lineHeight: 1.35 }}>{ai.action}</div>
          {ai.sev >= 2 && <span style={{ fontFamily: RADA.ui, fontSize: 10, color: RADA.high, fontWeight: 600 }}>운영자 승인 필요 · AI 단독 실행 금지</span>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: RADA.ui, fontSize: 10, color: ai.sev >= 2 ? RADA.high : RADA.normal, fontWeight: 600 }}><Ic name={ai.sev >= 2 ? 'alert' : 'check'} size={12} />{ai.sev >= 2 ? '조치 게이트 · 승인 대기' : '조치 불필요'}</span>
        </ZoneCard>
      </div>
    </div>
  );
}
