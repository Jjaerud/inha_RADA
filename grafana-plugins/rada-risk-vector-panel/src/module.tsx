import { PanelPlugin } from '@grafana/data';
import { RiskVectorPanel } from './components/RiskVectorPanel';
import { RiskVectorOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<RiskVectorOptions>(RiskVectorPanel).setPanelOptions((builder) => {
  const f = (path: keyof RiskVectorOptions, label: string) =>
    builder.addTextInput({ path, name: label, defaultValue: defaultOptions[path] as string, category: ['Field mapping'] });

  f('miningField', 'mining field');
  f('networkAbuseField', 'network_abuse field');
  f('threatField', 'threat field');
  f('agingField', 'aging field');
  f('malfunctionField', 'malfunction field');
  f('primaryTypeField', 'primary_type field');

  builder.addBooleanSwitch({ path: 'demoMode', name: 'Demo mode', defaultValue: defaultOptions.demoMode, category: ['Demo'] });
  return builder;
});
