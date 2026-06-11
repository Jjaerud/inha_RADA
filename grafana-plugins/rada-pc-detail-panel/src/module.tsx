import { PanelPlugin } from '@grafana/data';
import { PCDetailPanel } from './components/PCDetailPanel';
import { PCDetailOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<PCDetailOptions>(PCDetailPanel).setPanelOptions((builder) => {
  builder.addBooleanSwitch({ path: 'demoMode', name: 'Demo mode (design preview)', defaultValue: defaultOptions.demoMode });
  builder.addRadio({
    path: 'demoPc',
    name: 'Demo PC',
    defaultValue: defaultOptions.demoPc,
    settings: { options: [{ value: 'PC-07', label: 'PC-07 (위험)' }, { value: 'PC-12', label: 'PC-12 (정상)' }] },
  });
  return builder;
});
