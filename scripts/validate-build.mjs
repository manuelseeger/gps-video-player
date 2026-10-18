import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {init, parse} from 'es-module-lexer';
import {fileURLToPath} from 'node:url';
import {collectNotices, noticeBanner} from './notices.mjs';
const dir = new URL('../dist/', import.meta.url);
assert.deepEqual((await readdir(dir)).sort(), ['THIRD_PARTY_NOTICES.txt', 'player.js'], 'Build must contain one self-contained module and its notices');
const code = await readFile(new URL('player.js', dir), 'utf8');
await init;
const [imports, exports] = parse(code);
assert.equal(imports.filter(i => i.type !== 'import-meta').length, 0, 'No runtime module imports');
assert.ok(exports.some(e => e.name === 'createPlayer'));
for (const forbidden of ['localStorage', 'server.arcgisonline.com', 's3.amazonaws.com/elevation-tiles-prod', '/flight.igc', '/clips.json']) assert.ok(!code.includes(forbidden), forbidden);
assert.ok(code.includes('maplibregl-map'), 'Map CSS must be inline');
// Independently traverse local imports, including the renderer bridge and worker entry.
const visited = new Set(), dependencies = new Set();
async function visitSource(url) {
  if (visited.has(url.href)) return;
  visited.add(url.href);
  const [sourceImports] = parse(await readFile(url, 'utf8'));
  for (const {specifier:id} of sourceImports) {
    if (!id || id.startsWith('virtual:')) continue;
    const clean = id.split('?')[0];
    if (id.startsWith('.')) {
      if (clean.endsWith('.js')) await visitSource(new URL(clean, url));
    } else dependencies.add(fileURLToPath(import.meta.resolve(clean)));
  }
}
await visitSource(new URL('../src/player.js', import.meta.url));
dependencies.add(fileURLToPath(import.meta.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs')));
const {text:notices, entries} = await collectNotices([...dependencies]);
assert.equal(await readFile(new URL('THIRD_PARTY_NOTICES.txt', dir), 'utf8'), notices, 'Package notices must match the dependency graph');
assert.ok(code.startsWith(noticeBanner(notices)), 'CDN module must carry all full notices in its banner');
for (const name of ['maplibre-gl','@deck.gl/core','@luma.gl/core','@math.gl/core','gl-matrix','tslib','apache-arrow','murmurhash-js']) assert.ok(entries.some(p => p.name === name), `Missing transitive notices for ${name}`);
assert.ok(notices.includes('Apache Arrow JavaScript'), 'Apache NOTICE is required');
assert.ok(notices.includes('Contains code from mapbox-gl-js'), 'MapLibre vendored notices are required');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
assert.ok(pkg.files.includes('dist/THIRD_PARTY_NOTICES.txt'), 'Package must include the notice file');
console.log(`Full third-party notices validated (${entries.length} dependency entries).`);
console.log(`Single-module build validated (${(Buffer.byteLength(code)/1024/1024).toFixed(2)} MiB).`);
