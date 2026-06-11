// Score breakdown — display-only category shares. NOT the verdict driver
// (final score = 9 legacy categories → context → moving avg). retrieval is
// excluded (fixed at 0, FP-fix #4). Source: anomaly_history.scores.score_breakdown.

export interface ScoreBreakdownOptions {
  resourceField: string;
  networkField: string;
  processField: string;
  episodeField: string;
  correlationField: string;
  mlField: string;
  finalField: string;

  demoMode: boolean;
}

export const defaultOptions: ScoreBreakdownOptions = {
  resourceField: 'resource',
  networkField: 'network',
  processField: 'process',
  episodeField: 'episode',
  correlationField: 'correlation',
  mlField: 'ml',
  finalField: 'final',
  demoMode: false,
};
