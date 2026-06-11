// Ported demo data (PC_DATA) for design preview when no query data is bound.
export const VRAM_TOTAL_GB = 8.0;

function dSeries(seed: number, base: number, amp: number, n = 42, drift = 0, floor = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const noise = Math.sin(seed + i * 0.7) * 0.6 + Math.sin(seed * 0.3 + i * 1.9) * 0.4;
    out.push(Math.max(floor, base + noise * amp + drift * (i / n) * base));
  }
  return out;
}
function rampSeries(start: number, end: number, n: number, wob: number, seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(Math.max(0, start + (end - start) * t + Math.sin(seed + i * 0.9) * wob));
  }
  return out;
}

export const PC_DATA: Record<string, any> = {
  'PC-07': {
    id: 'PC-07', online: true, score: 16.8, cpu: 92, gpu: 93, mem: 77,
    series: { cpu: dSeries(42, 88, 5, 42, 0.05), mem: dSeries(31, 62, 6, 42, 0.14), gpu: dSeries(50, 89, 5, 42, 0.04), vramG: dSeries(91, 6.3, 0.4, 42, 0.18), netI: dSeries(12, 19, 7, 42, 0.3), netO: dSeries(48, 7, 4, 42, 0.15), disk: dSeries(77, 11, 5, 42, 0) },
    scoreSpark: rampSeries(7.6, 16.8, 30, 0.7, 3),
    risk: [{ axis: '채굴', value: 0.86 }, { axis: '오작동', value: 0.18 }, { axis: '노후화', value: 0.27 }, { axis: '위협', value: 0.34 }, { axis: '망 남용', value: 0.55 }],
    composition: [{ k: '리소스', pct: 22, flat: '#7c5cff' }, { k: '프로세스', pct: 20, flat: '#ec4899' }, { k: 'ML', pct: 18, flat: '#f59e0b' }, { k: '에피소드', pct: 16, flat: '#06b6d4' }, { k: '상관', pct: 13, flat: '#84cc16' }, { k: '네트워크', pct: 11, flat: '#3b82f6' }],
    ai: { grade: 'CONFIRMED', sev: 3, mock: true, fast: true, primaryType: '채굴', at: '2026-06-10 14:32:07', reason: 'xmrig.exe(known_miner)가 CPU 85%·GPU 90%+를 34분 지속 점유하고 텐서코어는 유휴 상태입니다. 비수업(Free) 슬롯에서 발생해 학습 작업으로 보기 어렵습니다.', signals: ['known_miner', 'cpu_sustained', 'gpu_sustained', 'tensor_idle', 'offhours', 'proc_path_temp', 'net_pool_like', 'no_class'], quality: { level: 'FULL', degraded: '없음' }, explain: { level: 'HIGH', basis: 'retrieval 유사 사례 4건 일치 (코사인 0.82+)' }, freshness: { missing: '0.4%', delay: '0.8s', lastSeen: '5초 전' }, contradicting: '반대 증거 없음 · 학습 프로세스·스케줄 부재', benign: '0.04 (낮음)', action: 'xmrig.exe 종료 및 실행 경로 격리 · 사용자 통지' },
  },
  'PC-12': {
    id: 'PC-12', online: true, score: 2.1, cpu: 14, gpu: 31, mem: 42,
    series: { cpu: dSeries(7, 14, 5, 42, 0), mem: dSeries(19, 42, 5, 42, 0.02), gpu: dSeries(23, 30, 9, 42, 0), vramG: dSeries(5, 2.6, 0.5, 42, 0), netI: dSeries(33, 8, 4, 42, 0), netO: dSeries(41, 5, 3, 42, 0), disk: dSeries(61, 6, 3, 42, 0) },
    scoreSpark: rampSeries(2.4, 2.1, 30, 0.45, 7),
    risk: [{ axis: '채굴', value: 0.06 }, { axis: '오작동', value: 0.10 }, { axis: '노후화', value: 0.14 }, { axis: '위협', value: 0.05 }, { axis: '망 남용', value: 0.08 }],
    composition: [{ k: '리소스', pct: 0, flat: '#7c5cff' }, { k: '프로세스', pct: 0, flat: '#ec4899' }, { k: 'ML', pct: 0, flat: '#f59e0b' }, { k: '에피소드', pct: 0, flat: '#06b6d4' }, { k: '상관', pct: 0, flat: '#84cc16' }, { k: '네트워크', pct: 0, flat: '#3b82f6' }],
    ai: { grade: 'NORMAL', sev: 0, mock: true, fast: false, primaryType: '없음', at: '2026-06-10 14:33:02', reason: '리소스·프로세스·네트워크 신호가 모두 베이스라인 범위입니다.', signals: [], quality: { level: 'FULL', degraded: '없음' }, explain: { level: 'HIGH', basis: '베이스라인 직접 비교' }, freshness: { missing: '0.2%', delay: '0.6s', lastSeen: '4초 전' }, contradicting: '해당 없음', benign: '0.96 (높음)', action: '조치 불필요 · 모니터링 유지' },
  },
};
