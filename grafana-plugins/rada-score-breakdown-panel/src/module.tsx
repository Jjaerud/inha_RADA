import { PanelPlugin } from '@grafana/data';
import { ScoreBreakdownPanel } from './components/ScoreBreakdownPanel';
import { ScoreBreakdownOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<ScoreBreakdownOptions>(ScoreBreakdownPanel).setPanelOptions((builder) => {
  const f = (path: keyof ScoreBreakdownOptions, label: string) =>
    builder.addTextInput({ path, name: label, defaultValue: defaultOptions[path] as string, category: ['Field mapping'] });

  f('resourceField', 'resource field');
  f('networkField', 'network field');
  f('processField', 'process field');
  f('episodeField', 'episode field');
  f('correlationField', 'correlation field');
  f('mlField', 'ml field');
  f('finalField', 'final field');

  builder.addBooleanSwitch({ path: 'demoMode', name: 'Demo mode', defaultValue: defaultOptions.demoMode, category: ['Demo'] });
  return builder;
});
