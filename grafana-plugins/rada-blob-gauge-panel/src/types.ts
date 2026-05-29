export interface BlobGaugeOptions {
  // Data binding
  valueField: string;
  totalField: string;       // optional — denominator for "x / y" subline
  labelTopText: string;     // small uppercase label e.g. "LAB HEALTH"
  labelMainText: string;    // large white text e.g. "실습실 정상 비율"
  sublineText: string;      // small subline e.g. "33 / 40대 정상"
  showDelta: boolean;
  deltaValue: string;       // free-form display like "↓ 1.5%"
  deltaIsNegative: boolean; // pink pill if true, mint if false

  // Visual
  size: number;             // diameter of the gauge in px
  ringWidth: number;        // stroke width
  showStars: boolean;       // decorative dots in bg
  ringGradient: 'mint' | 'cyan' | 'primary' | 'hot';

  // Demo
  demoValue: number;        // when no data, fall back to this for design preview
  demoMode: boolean;
}

export const defaultOptions: BlobGaugeOptions = {
  valueField: 'value',
  totalField: 'total',
  labelTopText: 'LAB HEALTH',
  labelMainText: '실습실 정상 비율',
  sublineText: '33 / 40대 정상',
  showDelta: true,
  deltaValue: '↓ 1.5%',
  deltaIsNegative: true,
  size: 170,
  ringWidth: 12,
  showStars: true,
  ringGradient: 'mint',
  demoValue: 82.5,
  demoMode: false,
};
