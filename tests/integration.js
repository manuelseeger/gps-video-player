// Page setup only. The library does not select providers or read page parameters.
const params = new URLSearchParams(location.search);
const source = params.has('source');
const moduleUrl = source ? '/src/player.js' : '/dist/player.js';
const single = document.body.dataset.demo === 'single';
const input = document.getElementById('manifest');
const status = document.getElementById('status');
const moduleSelect = document.getElementById('module');
const moduleInfo = document.getElementById('module-info');
const manifestLink = document.getElementById('manifest-link');
input.value = params.get('manifest') || input.value;
moduleSelect.value = source ? 'source' : 'built';
moduleInfo.textContent = `Module: ${moduleUrl} · Manifest: ${input.value}`;
function manifestUrl(value) {
  const url = new URL(value, location.href);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) manifest URL without embedded credentials.');
  return url.href;
}
moduleSelect.onchange = () => {
  const next = new URL(location.href);
  if (moduleSelect.value === 'source') next.searchParams.set('source', '');
  else next.searchParams.delete('source');
  next.searchParams.set('manifest', input.value);
  location.href = next.href;
};
const resourceErrors = [];
const players = [];
const removed = new Set();
try {
  const {createPlayer} = await import(/* @vite-ignore */ moduleUrl);
  const manifest = manifestUrl(input.value);
  manifestLink.href = manifest;
  const mounts = [...document.querySelectorAll('[data-player]')];
  for (const mount of mounts) {
    const player = createPlayer(mount, {manifest, muted:true});
    for (const type of ['error','maperror','mediaerror']) player.on(type, event => {
      resourceErrors.push({type,...event.detail});
      status.textContent = `${type}: ${event.detail.message}. Check the manifest and network access.`;
    });
    players.push(player);
  }
  // Demo-only inspection handle, used by the browser checks.
  window.demo = {players, createPlayer, resourceErrors};
  const showReady = () => {
    if (single) {
      // Set the public demo's initial presentation through its existing Swap
      // control. This is not part of the embedding API or library defaults.
      const root = mounts[0].firstElementChild.shadowRoot;
      if (players[0].state.mainView !== 'map') root.getElementById('swap').click();
      // Keep the test video secondary so it does not cover the mountain view.
      const inset = root.getElementById('inset-panel');
      Object.assign(inset.style, {width:'30%', height:'38%', left:'auto', right:'16px', top:'70px'});
    }
    status.textContent = `${single ? 'Player ready' : 'Two independent players ready'} · ${source ? 'Source modules' : 'Built ES module'} · ${input.value}. Map tiles load separately.`;
  };
  document.getElementById('load').onsubmit = async event => {
    event.preventDefault();
    try {
      const manifest = manifestUrl(input.value);
      manifestLink.href = manifest;
      moduleInfo.textContent = `Module: ${moduleUrl} · Manifest: ${manifest}`;
      status.textContent = 'Loading manifest…';
      await Promise.all(players.filter(p => !removed.has(p)).map(p => p.load(manifest)));
      showReady();
    } catch (error) { status.textContent = error.message; }
  };
  document.getElementById('remove')?.addEventListener('click', () => {
    players[1].destroy();
    removed.add(players[1]);
    status.textContent = 'Second player destroyed. The first player is independent.';
  });
  await Promise.all(players.map(p => p.ready));
  for (const button of document.querySelectorAll('[data-seek]')) {
    button.addEventListener('click', () => players[0].seek(Number(button.dataset.seek)));
  }
  showReady();
} catch (error) {
  status.textContent = `${error.message}. ${source ? 'Source modules need the Vite server: npm run dev.' : 'Run npm run build to create /dist/player.js.'}`;
}
