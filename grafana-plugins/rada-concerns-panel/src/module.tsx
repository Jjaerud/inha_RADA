import { PanelPlugin } from '@grafana/data';
import { ConcernsPanel } from './components/ConcernsPanel';
import { ConcernsOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<ConcernsOptions>(ConcernsPanel).setPanelOptions((builder) => {
  builder
    .addTextInput({ path: 'title', name: 'Title', defaultValue: defaultOptions.title })
    .addTextInput({ path: 'subtitle', name: 'Subtitle', defaultValue: defaultOptions.subtitle })
    .addTextInput({ path: 'actionLabel', name: 'Action text (plain)', defaultValue: defaultOptions.actionLabel })
    .addTextInput({ path: 'emptyText', name: 'Empty state text', description: '데이터 0건일 때 중앙에 표시할 문구', defaultValue: defaultOptions.emptyText })
    .addNumberInput({ path: 'maxRows', name: 'Max rows', defaultValue: defaultOptions.maxRows, settings: { min: 1, max: 20 } })
    .addRadio({
      path: 'cardTheme',
      name: 'Card accent theme',
      defaultValue: defaultOptions.cardTheme,
      settings: {
        options: [
          { value: 'rose',   label: 'Rose (Top concerns)' },
          { value: 'amber',  label: 'Amber (Anomaly feed)' },
          { value: 'cool',   label: 'Cool (blue→violet)' },
          { value: 'violet', label: 'Violet' },
          { value: 'mint',   label: 'Mint' },
          { value: 'cyan',   label: 'Cyan' },
          { value: 'gray',   label: 'Gray' },
        ],
      },
    })
    .addBooleanSwitch({
      path: 'showDescription',
      name: 'Show description line + arrow chevron (anomaly-feed style)',
      defaultValue: defaultOptions.showDescription,
    })
    .addBooleanSwitch({
      path: 'showRowArrow',
      name: 'Show row arrow (›)',
      defaultValue: defaultOptions.showRowArrow,
    });

  builder
    .addTextInput({ path: 'pcIdField', name: 'pc_id field', defaultValue: defaultOptions.pcIdField, category: ['Field mapping'] })
    .addTextInput({ path: 'severityField', name: 'severity field', defaultValue: defaultOptions.severityField, category: ['Field mapping'] })
    .addTextInput({ path: 'typeField', name: 'type field (line 1)', defaultValue: defaultOptions.typeField, category: ['Field mapping'] })
    .addTextInput({ path: 'descriptionField', name: 'description field (line 2)', defaultValue: defaultOptions.descriptionField, category: ['Field mapping'] })
    .addTextInput({ path: 'scoreField', name: 'score field', defaultValue: defaultOptions.scoreField, category: ['Field mapping'] })
    .addTextInput({ path: 'minutesAgoField', name: 'minutes_ago field', defaultValue: defaultOptions.minutesAgoField, category: ['Field mapping'] });

  builder.addBooleanSwitch({ path: 'demoMode', name: 'Demo mode', defaultValue: defaultOptions.demoMode, category: ['Demo'] });

  return builder;
});
