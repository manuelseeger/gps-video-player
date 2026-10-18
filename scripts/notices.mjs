import {readFile, readdir, realpath} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';

const noticeName = /^(?:licen[cs]e|copying|copyright|notice|third[-_]?party[-_]?notices?)(?:[._-].*)?$/i;

export function packageRoot(id) {
  // Use the last node_modules boundary to retain nested dependency versions.
  const match = id.replaceAll('\\', '/').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/);
  return match?.[1];
}

async function dependencyRoot(name, parent) {
  for (let dir = parent;; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    try { await readFile(join(candidate, 'package.json')); return candidate; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(dir) === dir) throw new Error(`Missing notice dependency ${name}`);
  }
}

async function noticeFiles(root, dir = root) {
  const files = [];
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await noticeFiles(root, path));
    else if (entry.isFile() && noticeName.test(entry.name)) files.push(path);
  }
  return files.sort();
}

/** Include the runtime closure too: prebuilt modules can hide dependencies from Rollup/esbuild. */
export async function collectNotices(moduleIds) {
  const packages = new Map();
  async function visit(path) {
    const root = await realpath(path);
    if (packages.has(root)) return;
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    packages.set(root, {root, pkg});
    for (const name of Object.keys(pkg.dependencies ?? {}).sort()) await visit(await dependencyRoot(name, root));
  }
  for (const id of moduleIds) {
    if (id.startsWith('\0')) continue;
    const root = packageRoot(resolve(id.split('?')[0]));
    if (root) await visit(root);
  }
  if (!packages.size) throw new Error('No bundled dependencies found for notices');
  const entries = [];
  for (const {root, pkg} of packages.values()) {
    const files = await noticeFiles(root);
    const documents = [];
    for (const path of files) {
      const text = (await readFile(path, 'utf8')).trim();
      if (!text) throw new Error(`Empty notice: ${pkg.name}/${path.slice(root.length + 1)}`);
      documents.push({file:path.slice(root.length + 1), text});
    }
    if (!documents.some(d => /^(?:licen[cs]e|copying)/i.test(d.file))) {
      // murmurhash-js ships its complete MIT grant in its README, not a LICENSE file.
      const readme = await readFile(join(root, 'README.md'), 'utf8').catch(() => '');
      const section = readme.match(/^## License[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.trim();
      if (!section || !section.includes('Copyright') || !section.includes('Permission')) throw new Error(`Missing full license text: ${pkg.name}@${pkg.version}`);
      documents.push({file:'README.md (License)', text:section});
    }
    entries.push({name:pkg.name, version:pkg.version, license:pkg.license, documents});
  }
  entries.sort((a,b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
  const text = 'THIRD-PARTY NOTICES\n\nFull license and notice texts for the bundled module and worker dependency graph.\nIncludes declared runtime dependency closures of prebuilt dependencies.\nThese terms apply to the named third-party components only.\n\n' + entries.map(p => [
    '='.repeat(78), `${p.name}@${p.version}`, `Package license metadata: ${p.license ?? 'see license text'}`,
    ...p.documents.map(d => `\n--- ${d.file} ---\n\n${d.text}`),
  ].join('\n')).join('\n\n') + '\n';
  return {entries, text};
}

// Line comments retain full text safely even when a notice contains a block-comment terminator.
export function noticeBanner(text) {
  return text.split(/\r?\n|\u2028|\u2029/).map(line => `// ${line}`).join('\n') + '\n';
}
