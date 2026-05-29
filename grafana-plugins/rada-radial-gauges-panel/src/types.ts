export type GaugeGradient = 'violet' | 'cool' | 'mint' | 'amber' | 'hot' | 'cyan';

export interface RadialGaugesOptions {
  title: string;
  subtitle: string;

  // Gauge 1 / 2 / 3 — labels + value bindings + gradient theme
  g1Label: string;
  g1Field: string;
  g1Gradient: GaugeGradient;
  g2Label: string;
  g2Field: string;
  g2Gradient: GaugeGradient;
  g3Label: string;
  g3Field: string;
  g3Gradient: GaugeGradient;

  // Visual
  showOrbit: boolean;
  showHalo: boolean;
  showFlowDash: boolean;
  showCenterDot: boolean;
  gaugeSize: number;            // base size in px (auto-fits to width too)

  // Demo
  demoMode: boolean;
  g1Demo: number;
  g2Demo: number;
  g3Demo: number;
}

export const defaultOptions: RadialGaugesOptions = {
  title: 'LAB 평균 자원',
  subtitle: '39대 평균 · last 5m',
  g1Label: 'CPU',
  g1Field: 'cpu',
  g1Gradient: 'violet',
  g2Label: 'GPU',
  g2Field: 'gpu',
  g2Gradient: 'cool',
  g3Label: 'RAM',
  g3Field: 'mem',
  g3Gradient: 'mint',
  showOrbit: true,
  showHalo: true,
  showFlowDash: true,
  showCenterDot: true,
  gaugeSize: 130,
  demoMode: false,
  g1Demo: 26.9,
  g2Demo: 22.6,
  g3Demo: 40.8,
};

// Gradient pair table — matches design/mockdata.jsx GRAD palette
export const GRADIENT_PAIRS: Record<GaugeGradient, [string, string]> = {
  violet: ['#6d4cff', '#f5588c'],   // CPU
  cool:   ['#3b82f6', '#6d4cff'],   // GPU
  mint:   ['#00b574', '#00c4d4'],   // RAM
  amber:  ['#fbbf24', '#ff7849'],
  hot:    ['#f43f5e', '#f5588c'],
  cyan:   ['#00c4d4', '#3b82f6'],
};
