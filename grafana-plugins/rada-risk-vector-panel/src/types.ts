// Risk vector — 5 axes projected from signals (additive, does NOT alter
// verdict). Query returns one row with the 5 numeric axis fields + the
// primary_type label. Source: anomaly_history.scores.risk_vector.

export interface RiskVectorOptions {
  miningField: string;
  networkAbuseField: string;
  threatField: string;
  agingField: string;
  malfunctionField: string;
  primaryTypeField: string;

  demoMode: boolean;
}

export const defaultOptions: RiskVectorOptions = {
  miningField: 'mining',
  networkAbuseField: 'network_abuse',
  threatField: 'threat',
  agingField: 'aging',
  malfunctionField: 'malfunction',
  primaryTypeField: 'primary_type',
  demoMode: false,
};
