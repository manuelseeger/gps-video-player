import {mergeConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import playerConfig from '../vite.config.js';

export default mergeConfig(playerConfig, {
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '/src': fileURLToPath(new URL('../src', import.meta.url)),
      '/dist': fileURLToPath(new URL('../dist', import.meta.url)),
    },
  },
});
