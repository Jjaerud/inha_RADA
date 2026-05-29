import { PanelPlugin } from '@grafana/data';
import { VerdictRibbonPanel } from './components/VerdictRibbonPanel';
import { VerdictRibbonOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<VerdictRibbonOptions>(VerdictRibbonPanel).setPanelOptions((builder) => {
  builder
    .addTextInput({ path: 'title', name: 'Title', defaultValue: defaultOptions.title })
    .addTextInput({ path: 'subtitle', name: 'Subtitle', defaultValue: defaultOptions.subtitle })
    .addNumberInput({ path: 'ribbonHeight', name: 'Ribbon height (px)', defaultValue: defaultOptions.ribbonHeight, settings: { min: 8, max: 80 } })
    .addBooleanSwitch({ path: 'showAbnormalBadge', name: 'Show abnormal badge', defaultValue: defaultOptions.showAbnormalBadge });

  builder
    .addBooleanSwitch({ path: 'animate', name: 'Animate', defaultValue: defaultOptions.animate, category: ['Animation'] })
    .addNumberInput({ path: 'pulseDurationSec', name: 'Pulse duration (s)', defaultValue: defaultOptions.pulseDurationSec, settings: { min: 1, max: 30 }, category: ['Animation'] });

  builder.addTextInput({
    path: 'segmentsJson',
    name: 'Segments (JSON)',
    description: '[{"name","count","color"}, ...] — used when DataFrame is missing required fields or demoMode',
    defaultValue: defaultOptions.segmentsJson,
    settings: { useTextarea: true, rows: 6 },
    category: ['Data'],
  });

  builder
    .addTextInput({ path: 'nameField', name: 'verdict name field', defaultValue: defaultOptions.nameField, category: ['Field mapping'] })
    .addTextInput({ path: 'countField', name: 'count field', defaultValue: defaultOptions.countField, category: ['Field mapping'] })
    .addTextInput({ path: 'colorField', name: 'color field (optional)', defaultValue: defaultOptions.colorField, category: ['Field mapping'] });

  builder.addBooleanSwitch({ path: 'demoMode', name: 'Demo mode', defaultValue: defaultOptions.demoMode, category: ['Demo'] });

  return builder;
});
