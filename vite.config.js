import {defineConfig} from 'vite';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {collectNotices, noticeBanner} from './scripts/notices.mjs';
const require = createRequire(import.meta.url);
const workerInputs = new Set();

export default defineConfig({
  define:{'process.env.NODE_ENV':JSON.stringify('production')},
  plugins:[{
    name:'inline-map-worker',
    buildStart() { workerInputs.clear(); },
    resolveId(id) { if (id === 'virtual:map-worker') return '\0map-worker'; },
    async load(id) {
      if (id !== '\0map-worker') return;
      const result = await build({entryPoints:[require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs')], bundle:true, write:false, metafile:true, format:'iife', minify:true, target:'es2022'});
      for (const path of Object.keys(result.metafile.inputs)) workerInputs.add(resolve(path));
      return `export default ${JSON.stringify(result.outputFiles[0].text)}`;
    },
  }, {
    name:'bundled-third-party-notices',
    async generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter(file => file.type === 'chunk');
      const ids = [...workerInputs, ...chunks.flatMap(chunk => Object.keys(chunk.modules))];
      const {text} = await collectNotices(ids);
      for (const chunk of chunks) chunk.code = noticeBanner(text) + chunk.code;
      this.emitFile({type:'asset', fileName:'THIRD_PARTY_NOTICES.txt', source:text});
    },
  }],
  build:{
    copyPublicDir:false, target:'es2022',
    lib:{entry:'src/player.js', formats:['es'], fileName:()=>'player.js'},
    rollupOptions:{output:{inlineDynamicImports:true}},
    chunkSizeWarningLimit:6000,
  },
  server:{host:'0.0.0.0', port:5173},
});
