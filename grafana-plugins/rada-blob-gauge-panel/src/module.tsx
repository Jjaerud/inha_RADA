import { PanelPlugin } from '@grafana/data';
import { BlobGaugePanel } from './components/BlobGaugePanel';
import { BlobGaugeOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<BlobGaugeOptions>(BlobGaugePanel).setPanelOptions((builder) => {
  builder
    .addTextInput({ path: 'labelTopText', name: 'Top label', defaultValue: defaultOptions.labelTopText })
    .addTextInput({ path: 'labelMainText', name: 'Main label', defaultValue: defaultOptions.labelMainText })
    .addTextInput({ path: 'sublineText', name: 'Subline', defaultValue: defaultOptions.sublineText })
    .addBooleanSwitch({ path: 'showDelta', name: 'Show delta pill', defaultValue: defaultOptions.showDelta })
    .addTextInput({ path: 'deltaValue', name: 'Delta text (e.g. ↓ 1.5%)', defaultValue: defaultOptions.deltaValue })
    .addBooleanSwitch({ path: 'deltaIsNegative', name: 'Delta is negative (rose pill)', defaultValue: defaultOptions.deltaIsNegative })
    .addNumberInput({ path: 'size', name: 'Gauge size (px)', defaultValue: defaultOptions.size, settings: { min: 80, max: 360 } })
    .addNumberInput({ path: 'ringWidth', name: 'Ring width (px)', defaultValue: defaultOptions.ringWidth, settings: { min: 4, max: 40 } })
    .addBooleanSwitch({ path: 'showStars', name: 'Show stars', defaultValue: defaultOptions.showStars })
    .addRadio({
      path: 'ringGradient',
      name: 'Ring gradient',
      defaultValue: defaultOptions.ringGradient,
      settings: {
        options: [
          { value: 'mint',    label: 'Mint (Lab Health)' },
          { value: 'cyan',    label: 'Cyan' },
          { value: 'primary', label: 'Violet' },
          { value: 'hot',     label: 'Hot (Risk)' },
        ],
      },
    });

  builder
    .addTextInput({ path: 'valueField', name: 'Value field', defaultValue: defaultOptions.valueField, category: ['Field mapping'] })
    .addTextInput({ path: 'totalField', name: 'Total field (optional)', defaultValue: defaultOptions.totalField, category: ['Field mapping'] });

  builder
    .addBooleanSwitch({ path: 'demoMode', name: 'Demo mode', defaultValue: defaultOptions.demoMode, category: ['Demo'] })
    .addNumberInput({ path: 'demoValue', name: 'Demo value', defaultValue: defaultOptions.demoValue, settings: { min: 0, max: 100 }, category: ['Demo'] });

  return builder;
});
