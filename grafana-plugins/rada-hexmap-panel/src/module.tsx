import { PanelPlugin } from '@grafana/data';
import { HexmapPanel } from './components/HexmapPanel';
import { HexmapOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<HexmapOptions>(HexmapPanel).setPanelOptions((builder) => {
  builder
    .addNumberInput({
      path: 'columns',
      name: 'Columns',
      description: '하나의 가로 줄에 들어갈 hex 개수 (8 = 5행 × 8 = 40대)',
      defaultValue: defaultOptions.columns,
      settings: { min: 1, max: 20, integer: true },
    })
    .addNumberInput({
      path: 'hexSize',
      name: 'Hex size (px)',
      defaultValue: defaultOptions.hexSize,
      settings: { min: 20, max: 200, integer: true },
    })
    .addBooleanSwitch({
      path: 'showLegend',
      name: 'Show legend',
      defaultValue: defaultOptions.showLegend,
    })
    .addBooleanSwitch({
      path: 'showTooltip',
      name: 'Show tooltip on hover',
      defaultValue: defaultOptions.showTooltip,
    })
    .addRadio({
      path: 'background',
      name: 'Background',
      description: 'React 디자인의 RADA palette 와 동일한 카드 배경. transparent 면 Grafana 기본 패널 배경 사용.',
      defaultValue: defaultOptions.background,
      settings: {
        options: [
          { value: 'lightGradient', label: 'Light gradient (권장)' },
          { value: 'darkGradient',  label: 'Dark gradient' },
          { value: 'light',         label: 'Light flat' },
          { value: 'transparent',   label: 'Transparent' },
        ],
      },
    })
    .addBooleanSwitch({
      path: 'showDecor',
      name: 'Show honeycomb decoration',
      defaultValue: defaultOptions.showDecor,
    })
    .addNumberInput({
      path: 'cornerRadius',
      name: 'Card corner radius (px)',
      defaultValue: defaultOptions.cornerRadius,
      settings: { min: 0, max: 40, integer: true },
    })
    .addBooleanSwitch({
      path: 'showBorder',
      name: 'Show card border',
      defaultValue: defaultOptions.showBorder,
    });

  // Inline title block (sits inside the card — distinct from Grafana
  // panel title, which is rendered outside the panel body)
  builder
    .addBooleanSwitch({
      path: 'showInnerTitle',
      name: 'Show inline title',
      defaultValue: defaultOptions.showInnerTitle,
      category: ['Inline title'],
    })
    .addTextInput({
      path: 'innerTitle',
      name: 'Title',
      defaultValue: defaultOptions.innerTitle,
      category: ['Inline title'],
    })
    .addTextInput({
      path: 'innerSubtitle',
      name: 'Subtitle',
      defaultValue: defaultOptions.innerSubtitle,
      category: ['Inline title'],
    });

  // Demo mode — synthesize mixed-severity cells when no real data is
  // available (useful for visual design verification before DB has rows).
  builder.addBooleanSwitch({
    path: 'demoMode',
    name: 'Demo data (40 mixed-severity cells)',
    description: '데이터가 없을 때 디자인 검증용. 운영에서는 OFF.',
    defaultValue: defaultOptions.demoMode,
    category: ['Demo'],
  });

  // Field mapping group — let users point at their column names.
  builder
    .addTextInput({
      path: 'pcIdField',
      name: 'PC ID field',
      defaultValue: defaultOptions.pcIdField,
      category: ['Field mapping'],
    })
    .addTextInput({
      path: 'scoreField',
      name: 'Score field',
      defaultValue: defaultOptions.scoreField,
      category: ['Field mapping'],
    })
    .addTextInput({
      path: 'severityField',
      name: 'Severity field',
      description: '정수 0~3 또는 문자열 NORMAL/LOW/MEDIUM/HIGH/OFFLINE. 비어있으면 score 임계값으로 추정.',
      defaultValue: defaultOptions.severityField,
      category: ['Field mapping'],
    })
    .addTextInput({
      path: 'cpuField',
      name: 'CPU field',
      defaultValue: defaultOptions.cpuField,
      category: ['Field mapping'],
    })
    .addTextInput({
      path: 'gpuField',
      name: 'GPU field',
      defaultValue: defaultOptions.gpuField,
      category: ['Field mapping'],
    })
    .addTextInput({
      path: 'memField',
      name: 'Memory field',
      defaultValue: defaultOptions.memField,
      category: ['Field mapping'],
    })
    .addTextInput({
      path: 'hostnameField',
      name: 'Hostname field',
      defaultValue: defaultOptions.hostnameField,
      category: ['Field mapping'],
    });

  // Thresholds — severity computed from score when severityField is empty
  builder
    .addNumberInput({
      path: 'thresholdLow',
      name: 'NORMAL → LOW threshold',
      defaultValue: defaultOptions.thresholdLow,
      category: ['Thresholds'],
    })
    .addNumberInput({
      path: 'thresholdMedium',
      name: 'LOW → MEDIUM threshold',
      defaultValue: defaultOptions.thresholdMedium,
      category: ['Thresholds'],
    })
    .addNumberInput({
      path: 'thresholdHigh',
      name: 'MEDIUM → HIGH threshold',
      defaultValue: defaultOptions.thresholdHigh,
      category: ['Thresholds'],
    });

  return builder;
});
