import { PanelPlugin, SelectableValue } from '@grafana/data';
import { RadialGaugesPanel } from './components/RadialGaugesPanel';
import { RadialGaugesOptions, GaugeGradient, defaultOptions } from './types';

const GRAD_OPTS: Array<SelectableValue<GaugeGradient>> = [
  { value: 'violet', label: 'Violet (CPU)' },
  { value: 'cool',   label: 'Cool blue→violet (GPU)' },
  { value: 'mint',   label: 'Mint (RAM)' },
  { value: 'amber',  label: 'Amber' },
  { value: 'hot',    label: 'Hot' },
  { value: 'cyan',   label: 'Cyan' },
];

export const plugin = new PanelPlugin<RadialGaugesOptions>(RadialGaugesPanel).setPanelOptions((builder) => {
  builder
    .addTextInput({ path: 'title', name: 'Title', defaultValue: defaultOptions.title })
    .addTextInput({ path: 'subtitle', name: 'Subtitle', defaultValue: defaultOptions.subtitle })
    .addNumberInput({ path: 'gaugeSize', name: 'Max gauge size (px)', defaultValue: defaultOptions.gaugeSize, settings: { min: 60, max: 300 } });

  builder
    .addTextInput({ path: 'g1Label', name: 'Label', defaultValue: defaultOptions.g1Label, category: ['Gauge 1'] })
    .addTextInput({ path: 'g1Field', name: 'Value field', defaultValue: defaultOptions.g1Field, category: ['Gauge 1'] })
    .addRadio({ path: 'g1Gradient', name: 'Gradient', defaultValue: defaultOptions.g1Gradient, settings: { options: GRAD_OPTS }, category: ['Gauge 1'] })
    .addNumberInput({ path: 'g1Demo', name: 'Demo value', defaultValue: defaultOptions.g1Demo, settings: { min: 0, max: 100 }, category: ['Gauge 1'] });

  builder
    .addTextInput({ path: 'g2Label', name: 'Label', defaultValue: defaultOptions.g2Label, category: ['Gauge 2'] })
    .addTextInput({ path: 'g2Field', name: 'Value field', defaultValue: defaultOptions.g2Field, category: ['Gauge 2'] })
    .addRadio({ path: 'g2Gradient', name: 'Gradient', defaultValue: defaultOptions.g2Gradient, settings: { options: GRAD_OPTS }, category: ['Gauge 2'] })
    .addNumberInput({ path: 'g2Demo', name: 'Demo value', defaultValue: defaultOptions.g2Demo, settings: { min: 0, max: 100 }, category: ['Gauge 2'] });

  builder
    .addTextInput({ path: 'g3Label', name: 'Label', defaultValue: defaultOptions.g3Label, category: ['Gauge 3'] })
    .addTextInput({ path: 'g3Field', name: 'Value field', defaultValue: defaultOptions.g3Field, category: ['Gauge 3'] })
    .addRadio({ path: 'g3Gradient', name: 'Gradient', defaultValue: defaultOptions.g3Gradient, settings: { options: GRAD_OPTS }, category: ['Gauge 3'] })
    .addNumberInput({ path: 'g3Demo', name: 'Demo value', defaultValue: defaultOptions.g3Demo, settings: { min: 0, max: 100 }, category: ['Gauge 3'] });

  builder
    .addBooleanSwitch({ path: 'showOrbit', name: 'Show dotted orbit (28s rotate)', defaultValue: defaultOptions.showOrbit, category: ['Effects'] })
    .addBooleanSwitch({ path: 'showHalo', name: 'Show halo glow (3.2s pulse)', defaultValue: defaultOptions.showHalo, category: ['Effects'] })
    .addBooleanSwitch({ path: 'showFlowDash', name: 'Show flowing dash (2.6s sweep)', defaultValue: defaultOptions.showFlowDash, category: ['Effects'] })
    .addBooleanSwitch({ path: 'showCenterDot', name: 'Endpoint center dot', defaultValue: defaultOptions.showCenterDot, category: ['Effects'] });

  builder.addBooleanSwitch({ path: 'demoMode', name: 'Demo mode', defaultValue: defaultOptions.demoMode, category: ['Demo'] });

  return builder;
});
