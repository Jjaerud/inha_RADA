// Options surface in the Panel editor sidebar.
export interface HexmapOptions {
  // Field name overrides — let users map their data frame to our cells.
  pcIdField: string;
  scoreField: string;
  severityField: string;
  cpuField: string;
  gpuField: string;
  memField: string;
  hostnameField: string;

  // Layout
  columns: number;        // hex columns per row (default 8 = 5 rows × 8 = 40)
  hexSize: number;        // base radius in px
  showLegend: boolean;
  showTooltip: boolean;

  // Fixed roster — always render this many cells; PCs without live data show
  // as OFFLINE. Lets a 3-PC pilot still display the full 40-cell honeycomb.
  fillToCount: number;    // pad up to this many cells (0 = only live cells)
  rosterIds: string;      // optional explicit roster, comma/space separated
                          // (e.g. "PC-01,PC-02,..."). Empty → auto PC-01..PC-N.

  // Severity thresholds (final score → color)
  thresholdLow: number;     // < this → NORMAL (green)
  thresholdMedium: number;  // < this → LOW (saffron)
  thresholdHigh: number;    // < this → MEDIUM (orange), >= → HIGH (rose)

  // Visual treatment — matches React mock design (rada-main · MainHoneycomb card)
  background: 'light' | 'lightGradient' | 'darkGradient' | 'transparent';
  showDecor: boolean;       // honeycomb cluster decoration in corner
  cornerRadius: number;     // panel inner card rounded-corner radius
  showBorder: boolean;      // card outline for light-theme contrast

  // Inline title / subtitle inside the panel body (React mock has it INSIDE
  // the card, not as a Grafana panel header)
  innerTitle: string;
  innerSubtitle: string;
  showInnerTitle: boolean;

  // Demo mode — when no data rows, render 40 synthetic cells with mixed
  // severity so the visual design is testable without a live client
  demoMode: boolean;

  // Click navigation — clicking a hex cell pushes to this dashboard path with
  // var-pc_id=<cell pc id> (current time range preserved). Empty = disabled.
  detailUrl: string;
}

export const defaultOptions: HexmapOptions = {
  pcIdField: 'pc_id',
  scoreField: 'score',
  severityField: 'severity',
  cpuField: 'cpu',
  gpuField: 'gpu',
  memField: 'mem',
  hostnameField: 'hostname',
  columns: 8,
  hexSize: 56,
  showLegend: true,
  showTooltip: true,
  fillToCount: 40,
  rosterIds: '',
  thresholdLow: 10,
  thresholdMedium: 20,
  thresholdHigh: 30,
  background: 'lightGradient',
  showDecor: false,
  cornerRadius: 18,
  showBorder: true,
  innerTitle: 'AI Agent 상태 · 40대 PC',
  innerSubtitle: 'PC 상태 현황',
  showInnerTitle: true,
  demoMode: false,
  detailUrl: '/d/rada-pc-detail',
};

// Domain type — one PC tile.
export interface PcCell {
  id: string;
  hostname: string;
  severity: -1 | 0 | 1 | 2 | 3;  // -1=offline, 0=normal, 1=low, 2=medium, 3=high
  score: number | null;
  cpu: number;
  gpu: number;
  mem: number;
}
