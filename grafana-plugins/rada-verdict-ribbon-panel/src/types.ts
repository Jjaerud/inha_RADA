export interface RibbonSegment {
  name: string;
  count: number;
  // Gradient pair — segment animates a sweep between these two hues. If
  // `colorTo` is omitted, falls back to a lightness-shifted variant of
  // `color` (single-hue pulse).
  color: string;
  colorTo?: string;
}

export interface VerdictRibbonOptions {
  title: string;
  subtitle: string;
  ribbonHeight: number;
  // Segments defined as JSON-string array to keep options simple. Parsed at
  // render time. Schema: [{ "name": "Normal", "count": 20, "color": "#00b574" }, ...]
  segmentsJson: string;
  // Field mapping (alternative — pulls from DataFrame when not in demo mode)
  nameField: string;
  countField: string;
  colorField: string;       // optional

  // Animation
  animate: boolean;
  pulseDurationSec: number;

  demoMode: boolean;
  showAbnormalBadge: boolean;
}

// Default segments — each uses a GRAD pair from design/mockdata.jsx so the
// ribbon pulse moves through two actual colors instead of a single hue.
//   Normal     → mint  (#00b574 → #00c4d4)
//   Mining     → hot   (#f43f5e → #f5588c)
//   Heavy Load → amber (#fbbf24 → #ff7849)
//   HW Error   → cool  (#3b82f6 → #6d4cff)
export const DEFAULT_SEGMENTS_JSON = JSON.stringify(
  [
    { name: 'Normal',     count: 20, color: '#00b574', colorTo: '#00c4d4' },
    { name: 'Mining',     count: 2,  color: '#f43f5e', colorTo: '#f5588c' },
    { name: 'Heavy Load', count: 2,  color: '#fbbf24', colorTo: '#ff7849' },
    { name: 'HW Error',   count: 1,  color: '#3b82f6', colorTo: '#6d4cff' },
  ],
);

export const defaultOptions: VerdictRibbonOptions = {
  title: 'AI 판단 분포 · 1h',
  subtitle: 'ai_judgment_history · 25건',
  ribbonHeight: 22,
  segmentsJson: DEFAULT_SEGMENTS_JSON,
  nameField: 'verdict',
  countField: 'count',
  colorField: 'color',
  animate: true,
  pulseDurationSec: 3,
  demoMode: false,
  showAbnormalBadge: true,
};
