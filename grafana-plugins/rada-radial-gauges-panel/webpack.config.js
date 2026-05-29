/* eslint-env node */
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/module.tsx',
  target: 'web',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'module.js',
    libraryTarget: 'amd',
    publicPath: 'public/plugins/rada-radial-gauges-panel/',
    clean: true,
  },
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  externals: ['react', 'react-dom', '@grafana/data', '@grafana/runtime', '@grafana/ui', '@emotion/css', '@emotion/react'],
  module: { rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }] },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'src/plugin.json', to: 'plugin.json' },
        { from: 'src/img', to: 'img', noErrorOnMissing: true },
        { from: 'README.md', to: 'README.md', noErrorOnMissing: true },
      ],
    }),
  ],
};
