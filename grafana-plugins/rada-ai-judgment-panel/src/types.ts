// Field-mapping options. Each maps a DataFrame column name (from the SQL
// query) to a slot in the AI judgment card. The query is expected to return a
// SINGLE row = the latest judgment+anomaly for the dashboard's $pc_id.
//
// JSON columns (active_signals / risk_vector reasons / sq_sources) arrive as
// text and are JSON.parsed in the panel. De-anchoring fields
// (benignConfidence / contradictingEvidence) are OPTIONAL — when the column is
// absent or empty (NCP mock, not yet persisted) the panel shows a "실 AI 적용
// 시 표시" placeholder instead of faking a value.

export interface AIJudgmentOptions {
  // scalar fields
  verdictField: string;          // anomaly_type / verdict  (NORMAL/OBSERVE/SUSPICIOUS/HIGH_RISK)
  severityField: string;         // overall_severity        (NORMAL/LOW/MEDIUM/HIGH)
  scoreField: string;            // scores.final
  isMockField: string;           // ai_judgment_history.is_mock
  reasonField: string;           // details.reason
  actionField: string;           // details.action
  signalQualityField: string;    // scores.signal_quality.overall  (FULL/PARTIAL/NONE)
  explConfidenceField: string;   // scores.explanation_confidence.level (LOW/MED/HIGH)
  primaryTypeField: string;      // scores.risk_vector.primary_type
  fastPathField: string;         // scores.evidence_meta.fast_path_match
  judgedAtField: string;         // judged_at

  // json (text) fields
  activeSignalsField: string;    // scores.evidence_meta.active_signals  (json array)
  explReasonsField: string;      // scores.explanation_confidence.reasons (json array)
  sqSourcesField: string;        // scores.signal_quality.sources         (json object)

  // de-anchoring (optional — may be empty until real AI + persistence)
  benignConfidenceField: string;       // LOW/MED/HIGH
  contradictingEvidenceField: string;  // json array or text

  // demo fallback for design preview (no data)
  demoMode: boolean;
}

export const defaultOptions: AIJudgmentOptions = {
  verdictField: 'verdict',
  severityField: 'severity',
  scoreField: 'score',
  isMockField: 'is_mock',
  reasonField: 'reason',
  actionField: 'action',
  signalQualityField: 'signal_quality',
  explConfidenceField: 'explanation_confidence',
  primaryTypeField: 'primary_type',
  fastPathField: 'fast_path',
  judgedAtField: 'judged_at',
  activeSignalsField: 'active_signals',
  explReasonsField: 'expl_reasons',
  sqSourcesField: 'sq_sources',
  benignConfidenceField: 'benign_confidence',
  contradictingEvidenceField: 'contradicting_evidence',
  demoMode: false,
};
