import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, copyFile, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'gps-video-player-types-'));
const run = (command, args, cwd = temp) => execFileSync(command, args, {
  cwd, stdio: 'inherit', env: {...process.env, npm_config_cache: join(temp, 'cache')},
});
try {
  run(join(root, 'node_modules/.bin/tsc'), [
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext',
    'tests/types/maplibre.ts',
  ], root);
  run('npm', ['pack', '--pack-destination', temp], root);
  const archives = (await readdir(temp)).filter(name => name.endsWith('.tgz'));
  assert.equal(archives.length, 1);
  await writeFile(join(temp, 'package.json'), JSON.stringify({private: true, type: 'module'}));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(temp, archives[0])]);
  assert.deepEqual((await readdir(join(temp, 'node_modules'))).filter(name => !name.startsWith('.')), ['gps-video-player']);
  const installed = join(temp, 'node_modules/gps-video-player');
  const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(pkg.types, './index.d.ts');
  assert.equal(Object.keys(pkg.exports['.'])[0], 'types');
  assert.equal(pkg.exports['.'].types, pkg.types);
  await copyFile(join(root, 'tests/types/consumer.ts'), join(temp, 'consumer.ts'));
  for (const [module, moduleResolution] of [['NodeNext', 'NodeNext'], ['ESNext', 'Bundler'], ['ESNext', 'Node10']]) {
    await writeFile(join(temp, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module, moduleResolution, strict: true, exactOptionalPropertyTypes: true,
        noEmit: true, skipLibCheck: false, lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        types: [],
      },
      files: ['consumer.ts'],
    }));
    run(join(root, 'node_modules/.bin/tsc'), ['--project', join(temp, 'tsconfig.json')]);
    console.log(`Packed consumer passed ${moduleResolution}`);
  }
} finally {
  await rm(temp, {recursive: true, force: true});
}
