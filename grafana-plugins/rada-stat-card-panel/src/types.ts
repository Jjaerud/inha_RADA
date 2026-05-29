export interface StatCardOptions {
  // Display
  category: string;          // top muted text e.g. "Threat · 30m"
  label: string;             // main label e.g. "채굴 의심"
  unit: string;              // optional unit suffix e.g. "/ 50"
  showDelta: boolean;
  deltaValue: string;        // free-form e.g. "+1" or "−1"
  deltaDirection: 'up' | 'down' | 'flat';
  deltaIsBad: boolean;       // true → up=bad (red), false → down=bad

  // Theme
  theme: 'rose' | 'amber' | 'gray' | 'violet' | 'mint' | 'cyan';

  // Sparkline
  showSparkline: boolean;
  sparklineHeight: number;
  xLabels: string;           // csv, evenly spaced under sparkline e.g. "-30m,-22m,-15m,-7m,now"
  tooltipFormat: string;     // template with {value} e.g. "{value}대 의심"

  // Data binding
  valueField: string;
  seriesField: string;       // time-series field name for sparkline; if absent uses first numeric series

  // Demo
  demoMode: boolean;
  demoValue: number;
  demoSparkline: string;     // comma-separated values e.g. "1,1,1,2,2,2"
}

export const defaultOptions: StatCardOptions = {
  category: 'Threat · 30m',
  label: '채굴 의심',
  unit: '',
  showDelta: true,
  deltaValue: '+1',
  deltaDirection: 'up',
  deltaIsBad: true,
  theme: 'rose',
  showSparkline: true,
  sparklineHeight: 60,
  xLabels: '-30m,-22m,-15m,-7m,now',
  tooltipFormat: '{value}',
  valueField: 'value',
  seriesField: 'series',
  demoMode: false,
  demoValue: 2,
  demoSparkline: '1,1,1,1,1,1,2,2,2,2,2,2',
};
