import { PanelPlugin } from '@grafana/data';
import { AIJudgmentPanel } from './components/AIJudgmentPanel';
import { AIJudgmentOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<AIJudgmentOptions>(AIJudgmentPanel).setPanelOptions((builder) => {
  const cat = (name: string, path: keyof AIJudgmentOptions, label: string) =>
    builder.addTextInput({ path, name: label, defaultValue: defaultOptions[path] as string, category: ['Field mapping'] });

  cat('verdict', 'verdictField', 'Verdict field');
  cat('severity', 'severityField', 'Severity field');
  cat('score', 'scoreField', 'Score field');
  cat('isMock', 'isMockField', 'is_mock field');
  cat('reason', 'reasonField', 'Reason field');
  cat('action', 'actionField', 'Action field');
  cat('signalQuality', 'signalQualityField', 'signal_quality field');
  cat('explConfidence', 'explConfidenceField', 'explanation_confidence field');
  cat('primaryType', 'primaryTypeField', 'primary_type field');
  cat('fastPath', 'fastPathField', 'fast_path field');
  cat('judgedAt', 'judgedAtField', 'judged_at field');
  cat('activeSignals', 'activeSignalsField', 'active_signals (json) field');
  cat('explReasons', 'explReasonsField', 'expl_reasons (json) field');
  cat('sqSources', 'sqSourcesField', 'sq_sources (json) field');
  cat('benignConfidence', 'benignConfidenceField', 'benign_confidence field (optional)');
  cat('contradicting', 'contradictingEvidenceField', 'contradicting_evidence field (optional)');

  builder.addBooleanSwitch({
    path: 'demoMode',
    name: 'Demo mode (design preview, no data)',
    defaultValue: defaultOptions.demoMode,
    category: ['Demo'],
  });

  return builder;
});
