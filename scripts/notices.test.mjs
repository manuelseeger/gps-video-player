import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectNotices, noticeBanner, packageRoot} from './notices.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'fliew-notices-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  return async (name, pkg, files = {}) => {
    const dir = join(root, 'node_modules', name);
    await mkdir(dir, {recursive:true});
    await writeFile(join(dir, 'package.json'), JSON.stringify({name, version:'1.0.0', ...pkg}));
    for (const [file,text] of Object.entries(files)) {
      await mkdir(join(dir, file, '..'), {recursive:true});
      await writeFile(join(dir, file), text);
    }
    return join(dir, 'index.js');
  };
}

test('notices include full licenses, Apache NOTICE, nested licenses and prebundled runtime dependencies', async t => {
  const add = await fixture(t);
  const main = await add('main', {license:'MIT', dependencies:{child:'1.0.0'}}, {'LICENSE':'Full MIT grant */ retained.', 'vendor/LICENSE.txt':'Vendor terms'});
  await add('child', {license:'Apache-2.0'}, {'LICENSE.txt':'Full Apache grant', 'NOTICE':'Apache attribution'});
  const {text,entries} = await collectNotices([main,main,'\0virtual:worker']);
  assert.deepEqual(entries.map(p=>p.name), ['child','main']);
  for (const expected of ['Full MIT grant */ retained.','Vendor terms','Full Apache grant','Apache attribution']) assert.ok(text.includes(expected));
  const banner = noticeBanner(text);
  assert.ok(banner.split('\n').every(line=>!line || line.startsWith('// ')));
  assert.doesNotThrow(()=>new Function(banner));
});

test('notices retain nested package versions and license text from README', async t => {
  const add = await fixture(t);
  const main = await add('main', {dependencies:{child:'2.0.0'}}, {'LICENSE':'Main grant'});
  const child = await add('child', {}, {'README.md':'# Child\n\n## License (MIT)\n\nCopyright child\nPermission is granted.\n\n## Other\nNot license text'});
  const nested = await add('main/node_modules/child', {name:'child',version:'2.0.0'}, {'LICENSE':'Nested child grant'});
  assert.ok(packageRoot(nested).endsWith('/main/node_modules/child'));
  const {text,entries} = await collectNotices([main,child]);
  assert.deepEqual(entries.map(p=>`${p.name}@${p.version}`), ['child@1.0.0','child@2.0.0','main@1.0.0']);
  assert.ok(text.includes('Copyright child\nPermission is granted.'));
  assert.ok(!text.includes('Not license text'));
});

test('missing license text or dependency fails closed', async t => {
  const add = await fixture(t);
  const missing = await add('missing', {license:'MIT'});
  await assert.rejects(collectNotices([missing]), /Missing full license text/);
  const parent = await add('parent', {dependencies:{absent:'1.0.0'}}, {'LICENSE':'Parent grant'});
  await assert.rejects(collectNotices([parent]), /Missing notice dependency/);
  await assert.rejects(collectNotices([]), /No bundled dependencies/);
});
