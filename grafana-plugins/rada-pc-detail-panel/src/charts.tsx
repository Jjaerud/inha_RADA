import React from 'react';
import { RADA } from './theme';

// Responsive time series — renders at native pixel size (measured via
// ResizeObserver) so axis text is NOT distorted. Live-updates as the bound
// data array grows/shifts.
export function TimeSeries({ series, yMax = 50, xLabels = ['1h', '45m', '30m', '15m', 'now'], thresholds = [], cursor = null, onCursor, spanMin = 60 }: any) {
  const uid = React.useId().replace(/[:]/g, '');
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const padL = 34, padR = 26, padT = 12, padB = 20;
  const w = size.w, h = size.h;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const N = series[0]?.data.length ?? 0;
  const xs = (i: number) => padL + (N <= 1 ? 0 : (i / (N - 1)) * innerW);
  const ys = (v: number) => padT + innerH - (Math.min(v, yMax) / yMax) * innerH;

  const handleMove = (e: React.MouseEvent) => {
    if (!onCursor) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    const f = Math.max(0, Math.min(1, (px - padL) / innerW));
    onCursor(f);
  };
  const ci = cursor == null ? null : Math.round(cursor * (N - 1));
  const cx = ci == null ? null : xs(ci);
  const leftPct = ci == null ? 0 : (xs(ci) / w) * 100;
  const minsAgo = ci == null ? 0 : Math.round((1 - ci / Math.max(1, N - 1)) * spanMin);
  const baseNow = React.useMemo(() => Date.now(), [N]);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const td = ci == null ? null : new Date(baseNow - minsAgo * 60000);
  const timeLabel = td == null ? '' : `${td.getFullYear()}-${pad2(td.getMonth() + 1)}-${pad2(td.getDate())} ${pad2(td.getHours())}:${pad2(td.getMinutes())}:00`;
  const flip = leftPct > 52;

  return (
    <div ref={ref} style={{ width: '100%', height: '100%', flex: 1, minHeight: 0, position: 'relative' }}>
      {w > 1 && h > 1 && (
        <svg width={w} height={h} style={{ display: 'block', cursor: onCursor ? 'crosshair' : 'default' }}
          onMouseMove={handleMove} onMouseLeave={() => onCursor && onCursor(null)}>
          <defs>
            {series.map((s: any, i: number) => (
              <linearGradient key={i} id={`ts-${uid}-${i}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={s.fillOpacity ?? 0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
            const y = padT + innerH - f * innerH;
            const edge = i === 0 || i === 4;
            return (
              <g key={i}>
                <line x1={padL} x2={w - padR} y1={y} y2={y} stroke={edge ? '#cdd2e4' : '#e2e5f1'} strokeWidth={1} strokeDasharray={edge ? '' : '2 5'} />
                <text x={padL - 7} y={y + 3} textAnchor="end" style={{ fontFamily: RADA.mono, fontSize: 9, fill: RADA.fgMid }}>{Math.round(f * yMax)}</text>
              </g>
            );
          })}
          {thresholds.map((t: any, i: number) => (
            <g key={'th' + i}>
              <line x1={padL} x2={w - padR} y1={ys(t.value)} y2={ys(t.value)} stroke={t.color} strokeDasharray="5 3" strokeOpacity={0.85} strokeWidth={1.4} />
              <text x={w - padR + 2} y={ys(t.value) + 3.4} textAnchor="start" style={{ fontFamily: RADA.mono, fontSize: 10, fontWeight: 700, fill: t.color }}>{t.value}</text>
            </g>
          ))}
          {series.map((s: any, si: number) => {
            if (!s.data.length) return null;
            const pts = s.data.map((v: number, i: number) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' L');
            const d = `M${pts}`;
            const area = `${d} L${xs(N - 1).toFixed(1)},${ys(0)} L${xs(0).toFixed(1)},${ys(0)} Z`;
            return (
              <g key={si}>
                {s.fill && <path d={area} fill={`url(#ts-${uid}-${si})`} />}
                <path d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeLinejoin="round" strokeLinecap="round" strokeOpacity={s.opacity ?? 1} />
              </g>
            );
          })}
          {xLabels.map((l: string, i: number) => {
            const x = padL + (i / (xLabels.length - 1)) * innerW;
            return <text key={i} x={x} y={h - 5} textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'} style={{ fontFamily: RADA.mono, fontSize: 9, fill: RADA.fgMid }}>{l}</text>;
          })}
          {cx != null && N > 0 && (
            <g>
              <line x1={cx} x2={cx} y1={padT} y2={padT + innerH} stroke={RADA.fgMid} strokeWidth={1} strokeOpacity={0.45} strokeDasharray="3 3" />
              {series.map((s: any, si: number) => s.data[ci as number] != null && <circle key={si} cx={cx} cy={ys(s.data[ci as number])} r={3.4} fill={s.color} stroke="#fff" strokeWidth={1.6} />)}
            </g>
          )}
        </svg>
      )}
      {ci != null && N > 0 && (
        <div style={{ position: 'absolute', top: 4, left: `${leftPct}%`, transform: flip ? 'translateX(-100%) translateX(-8px)' : 'translateX(8px)', background: '#fff', border: `1px solid ${RADA.border}`, borderRadius: 7, boxShadow: '0 6px 18px rgba(15,20,50,0.14)', padding: '6px 9px', pointerEvents: 'none', zIndex: 5, minWidth: 140 }}>
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
