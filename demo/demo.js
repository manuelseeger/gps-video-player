const params = new URLSearchParams(location.search);
const source = params.has('source');
const moduleUrl = source ? '/src/player.js' : '/dist/player.js';
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
try {
  const {createPlayer} = await import(/* @vite-ignore */ moduleUrl);
  const manifest = manifestUrl(input.value);
  manifestLink.href = manifest;
  const mount = document.getElementById('first');
  const player = createPlayer(mount, {manifest, muted:true});
  const resourceErrors = [];
  for (const type of ['error','maperror','mediaerror']) player.on(type, event => {
    resourceErrors.push({type,...event.detail});
    status.textContent = `${type}: ${event.detail.message}. Check the manifest and network access.`;
  });
  // Inspection handle for browser checks.
  window.demo = {players:[player], createPlayer, resourceErrors};
  const showReady = () => {
    const root = mount.firstElementChild.shadowRoot;
    if (player.state.mainView !== 'video') root.getElementById('swap').click();
    const inset = root.getElementById('inset-panel');
    Object.assign(inset.style, {width:'30%', height:'38%', left:'auto', right:'16px', top:'70px'});
    status.textContent = `Player ready · ${source ? 'Source modules' : 'Built ES module'} · ${input.value}. Map tiles load separately.`;
  };
  document.getElementById('load').onsubmit = async event => {
    event.preventDefault();
    try {
      const manifest = manifestUrl(input.value);
      manifestLink.href = manifest;
      moduleInfo.textContent = `Module: ${moduleUrl} · Manifest: ${manifest}`;
      status.textContent = 'Loading manifest…';
      await player.load(manifest);
      showReady();
    } catch (error) { status.textContent = error.message; }
  };
  await player.ready;
  for (const button of document.querySelectorAll('[data-seek]')) {
    button.addEventListener('click', () => player.seek(Number(button.dataset.seek)));
  }
  showReady();
} catch (error) {
  status.textContent = `${error.message}. ${source ? 'Source modules need the Vite server: npm run dev.' : 'Run npm run build to create /dist/player.js.'}`;
}
