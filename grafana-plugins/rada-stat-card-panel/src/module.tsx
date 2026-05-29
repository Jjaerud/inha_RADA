import { PanelPlugin } from '@grafana/data';
import { StatCardPanel } from './components/StatCardPanel';
import { StatCardOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<StatCardOptions>(StatCardPanel).setPanelOptions((builder) => {
  builder
    .addTextInput({ path: 'category', name: 'Category', defaultValue: defaultOptions.category })
    .addTextInput({ path: 'label', name: 'Label', defaultValue: defaultOptions.label })
    .addTextInput({ path: 'unit', name: 'Unit (optional)', defaultValue: defaultOptions.unit })
    .addRadio({
      path: 'theme',
      name: 'Theme',
      defaultValue: defaultOptions.theme,
      settings: {
        options: [
          { value: 'rose',   label: 'Rose (Threat)' },
          { value: 'amber',  label: 'Amber (Watch)' },
          { value: 'gray',   label: 'Gray (Connectivity)' },
          { value: 'violet', label: 'Violet (Risk)' },
          { value: 'mint',   label: 'Mint (Healthy)' },
          { value: 'cyan',   label: 'Cyan' },
        ],
      },
    });

  builder
    .addBooleanSwitch({ path: 'showDelta', name: 'Show delta pill', defaultValue: defaultOptions.showDelta, category: ['Delta'] })
    .addTextInput({ path: 'deltaValue', name: 'Delta text', defaultValue: defaultOptions.deltaValue, category: ['Delta'] })
    .addRadio({
      path: 'deltaDirection',
      name: 'Delta direction',
      defaultValue: defaultOptions.deltaDirection,
      settings: { options: [{ value: 'up', label: '▲ up' }, { value: 'down', label: '▼ down' }, { value: 'flat', label: '— flat' }] },
      category: ['Delta'],
    })
    .addBooleanSwitch({ path: 'deltaIsBad', name: 'Delta is bad (rose)', defaultValue: defaultOptions.deltaIsBad, category: ['Delta'] });

  builder
    .addBooleanSwitch({ path: 'showSparkline', name: 'Show sparkline', defaultValue: defaultOptions.showSparkline, category: ['Sparkline'] })
    .addNumberInput({ path: 'sparklineHeight', name: 'Sparkline height (px)', defaultValue: defaultOptions.sparklineHeight, settings: { min: 20, max: 200 }, category: ['Sparkline'] })
    .addTextInput({
      path: 'xLabels',
      name: 'X-axis labels (csv)',
      description: 'Evenly spaced under the line. e.g. "-30m,-22m,-15m,-7m,now"',
      defaultValue: defaultOptions.xLabels,
      category: ['Sparkline'],
    })
    .addTextInput({
      path: 'tooltipFormat',
      name: 'Tooltip text',
      description: '{value} 토큰이 hover 한 데이터 값으로 치환됨. 예: "{value}대 의심"',
      defaultValue: defaultOptions.tooltipFormat,
      category: ['Sparkline'],
    });

  builder
    .addTextInput({ path: 'valueField', name: 'Value field', defaultValue: defaultOptions.valueField, category: ['Field mapping'] })
    .addTextInput({ path: 'seriesField', name: 'Series field', defaultValue: defaultOptions.seriesField, category: ['Field mapping'] });

  builder
    .addBooleanSwitch({ path: 'demoMode', name: 'Demo mode', defaultValue: defaultOptions.demoMode, category: ['Demo'] })
    .addNumberInput({ path: 'demoValue', name: 'Demo value', defaultValue: defaultOptions.demoValue, category: ['Demo'] })
    .addTextInput({ path: 'demoSparkline', name: 'Demo sparkline (csv)', defaultValue: defaultOptions.demoSparkline, category: ['Demo'] });

  return builder;
});
