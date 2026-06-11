import React from 'react';
import { RADA } from './theme';

// Ported from charts.jsx — light theme time series w/ shared crosshair tooltip.
export function TimeSeries({ series, yMax = 50, xLabels = ['1h', '45m', '30m', '15m', 'now'], thresholds = [], height = 150, cursor = null, onCursor, spanMin = 60 }: any) {
  const uid = React.useId().replace(/[:]/g, '');
  const padL = 38, padR = 30, padT = 14, padB = 24;
  const w = 600, h = height;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const N = series[0]?.data.length ?? 60;
  const xs = (i: number) => padL + (i / (N - 1)) * innerW;
  const ys = (v: number) => padT + innerH - (Math.min(v, yMax) / yMax) * innerH;

  const handleMove = (e: React.MouseEvent) => {
    if (!onCursor) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vbX = ((e.clientX - r.left) / r.width) * w;
    const f = Math.max(0, Math.min(1, (vbX - padL) / innerW));
    onCursor(f);
  };
  const ci = cursor == null ? null : Math.round(cursor * (N - 1));
  const cx = ci == null ? null : xs(ci);
  const leftPct = ci == null ? 0 : (xs(ci) / w) * 100;
  const minsAgo = ci == null ? 0 : Math.round((1 - ci / (N - 1)) * spanMin);
  const baseNow = React.useMemo(() => Date.now(), []);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const td = ci == null ? null : new Date(baseNow - minsAgo * 60000);
  const timeLabel = td == null ? '' : `${td.getFullYear()}-${pad2(td.getMonth() + 1)}-${pad2(td.getDate())} ${pad2(td.getHours())}:${pad2(td.getMinutes())}:00`;
  const flip = leftPct > 52;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
        onMouseMove={handleMove} onMouseLeave={() => onCursor && onCursor(null)}
        style={{ width: '100%', flex: 1, minHeight: 0, display: 'block', cursor: onCursor ? 'crosshair' : 'default' }}>
        <defs>
          {series.map((s: any, i: number) => (
            <linearGradient key={i} id={`ts-${uid}-${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={s.fillOpacity ?? 0.22} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {xLabels.map((_: any, i: number) => {
          const x = padL + (i / (xLabels.length - 1)) * innerW;
          return <line key={'v' + i} x1={x} x2={x} y1={padT} y2={padT + innerH} stroke="#eceef6" strokeWidth={1} />;
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const y = padT + innerH - f * innerH;
          const edge = i === 0 || i === 4;
          return (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke={edge ? '#cdd2e4' : '#e2e5f1'} strokeWidth={edge ? 1.3 : 1} strokeDasharray={edge ? '' : '2 5'} />
              <text x={padL - 8} y={y + 3} textAnchor="end" style={{ fontFamily: RADA.mono, fontSize: 9, fill: RADA.fgMid }}>{Math.round(f * yMax)}</text>
            </g>
          );
        })}
        {thresholds.map((t: any, i: number) => (
          <g key={'th' + i}>
            <line x1={padL} x2={w - padR} y1={ys(t.value)} y2={ys(t.value)} stroke={t.color} strokeDasharray="5 3" strokeOpacity={0.85} strokeWidth={1.5} />
            <text x={w - padR + 3} y={ys(t.value) + 3.4} textAnchor="start" style={{ fontFamily: RADA.mono, fontSize: 10.5, fontWeight: 700, fill: t.color }}>{t.value}</text>
          </g>
        ))}
        {series.map((s: any, si: number) => {
          const pts = s.data.map((v: number, i: number) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' L');
          const d = `M${pts}`;
          const area = `${d} L${xs(N - 1)},${ys(0)} L${xs(0)},${ys(0)} Z`;
          return (
            <g key={si}>
              {s.fill && <path d={area} fill={`url(#ts-${uid}-${si})`} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeLinejoin="round" strokeOpacity={s.opacity ?? 1} />
            </g>
          );
        })}
        {xLabels.map((l: string, i: number) => {
          const x = padL + (i / (xLabels.length - 1)) * innerW;
          return <text key={i} x={x} y={h - 6} textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'} style={{ fontFamily: RADA.mono, fontSize: 9.5, fill: RADA.fgMid }}>{l}</text>;
        })}
        {cx != null && (
          <g>
            <line x1={cx} x2={cx} y1={padT} y2={padT + innerH} stroke={RADA.fgMid} strokeWidth={1} strokeOpacity={0.45} strokeDasharray="3 3" />
            {series.map((s: any, si: number) => <circle key={si} cx={cx} cy={ys(s.data[ci as number])} r={3.6} fill={s.color} stroke="#fff" strokeWidth={1.6} />)}
          </g>
        )}
      </svg>
      {ci != null && (
        <div style={{ position: 'absolute', top: 6, left: `${leftPct}%`, transform: flip ? 'translateX(-100%) translateX(-8px)' : 'translateX(8px)', background: '#fff', border: `1px solid ${RADA.border}`, borderRadius: 7, boxShadow: '0 6px 18px rgba(15,20,50,0.14)', padding: '6px 9px', pointerEvents: 'none', zIndex: 5, minWidth: 150 }}>
          <div style={{ fontFamily: RADA.mono, fontSize: 10, color: RADA.fgMid, fontWeight: 700, marginBottom: 4 }}>{timeLabel}<span style={{ color: RADA.fgMuted, fontWeight: 500 }}> · {minsAgo <= 0 ? 'now' : `−${minsAgo}m`}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {series.map((s: any, si: number) => (
              <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 7, background: s.color, flex: '0 0 auto' }} />
                <span style={{ fontFamily: RADA.ui, fontSize: 10.5, color: RADA.fgMuted, fontWeight: 500 }}>{s.name}</span>
                <span style={{ marginLeft: 'auto', fontFamily: RADA.mono, fontSize: 11, color: RADA.fg, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{(s.fmt ? s.fmt(s.data[ci as number]) : Math.round(s.data[ci as number]))}{s.unit || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
