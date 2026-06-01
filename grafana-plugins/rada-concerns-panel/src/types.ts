export interface ConcernsOptions {
  title: string;
  subtitle: string;
  actionLabel: string;     // plain right-side text (e.g. "전체 6건" or "전체 6건 → Alerts")
  maxRows: number;

  // Visual theme — controls the top-right radial accent color
  cardTheme: 'rose' | 'amber' | 'cool' | 'violet' | 'mint' | 'cyan' | 'gray';
  showRowArrow: boolean;   // chevron at the end of each row

  // Field mapping
  pcIdField: string;
  severityField: string;
  typeField: string;       // short type tag (line 1) — e.g. "mining suspected"
  descriptionField: string;// longer description (line 2) — optional
  showDescription: boolean;
  scoreField: string;
  minutesAgoField: string;

  // 데이터 0건일 때 중앙에 표시할 안내 문구(허전함 방지). 비우면 기본 문구.
  emptyText: string;

  // Demo
  demoMode: boolean;
}

export const defaultOptions: ConcernsOptions = {
  title: 'Top concerns · live',
  subtitle: 'severity desc · 클릭 → PC 상세',
  actionLabel: '전체 6건',
  maxRows: 5,
  cardTheme: 'rose',
  showRowArrow: false,
  pcIdField: 'pc_id',
  severityField: 'severity',
  typeField: 'type',
  descriptionField: 'description',
  showDescription: false,
  scoreField: 'score',
  minutesAgoField: 'minutes_ago',
  emptyText: '표시할 항목이 없습니다',
  demoMode: false,
};

export interface ConcernRow {
  pcId: string;
  severity: 0 | 1 | 2 | 3 | -1;
  type: string;
  description?: string;
  score: number;
  minutesAgo: number;
}

// Demo rows include BOTH a short type tag and a longer description so a
// panel instance can opt into single-line (Top concerns) or two-line
// (이상 탐지 피드 · anomaly_history) layout.
export const DEMO_ROWS: ConcernRow[] = [
  { pcId: 'PC-07', severity: 3, type: 'mining suspected', description: 'Sustained GPU utilization with low entropy workload', score: 42.5, minutesAgo: 3 },
  { pcId: 'PC-13', severity: 3, type: 'mining suspected', description: 'Tensor core idle while SM > 90%',                     score: 38.2, minutesAgo: 7 },
  { pcId: 'PC-04', severity: 2, type: 'needs review',     description: 'Elevated CPU baseline drift',                          score: 24.0, minutesAgo: 11 },
  { pcId: 'PC-21', severity: 2, type: 'needs review',     description: 'GPU utilization above class slot threshold',           score: 21.5, minutesAgo: 17 },
  { pcId: 'PC-29', severity: 2, type: 'needs review',     description: 'Memory pressure rising trend',                         score: 19.0, minutesAgo: 25 },
];
