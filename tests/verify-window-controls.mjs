import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDemoServer} from './server.mjs';

const screenshots = await mkdtemp(join(tmpdir(), 'gps-window-controls-'));
const server = createDemoServer();
let browser;
try {
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(base + '/') || route.request().url().startsWith('blob:')
    ? route.continue() : route.abort());
  await page.goto(base + '/integration.html');
  await page.waitForFunction(() => window.demo?.players.every(p => p.state?.mapReady && p.state.phase === 'paused'));
  await page.evaluate(async () => {
    const manifest = await (await fetch('/fixtures/regression/manifest.json')).json();
    manifest.version = 2;
    manifest.qualities = {options: [{id: 'economy', label: 'Data saver'}, {id: 'detail', label: 'Fine view'}],
      default: 'economy', fallback: []};
    manifest.clips = manifest.clips.map(({url, mediaOffsetSeconds, ...clip}) => ({...clip, sources: {
      economy: {url, mediaStartSeconds: mediaOffsetSeconds},
      detail: {url: url + '?detail', mediaStartSeconds: mediaOffsetSeconds},
    }}));
    window.windowControlsManifest = manifest;
    await window.demo.players[0].load(manifest, {baseUrl: new URL('/fixtures/regression/manifest.json', location.href).href});
    document.querySelector('#second').style.display = 'none';
    document.querySelector('body > header').style.display = 'none';
    document.querySelector('body > footer').style.display = 'none';
    document.querySelector('#players').style.cssText = 'display:block;margin:0;padding:0';
    document.querySelector('#first').style.cssText = 'width:1100px;height:660px';
  });
  const first = page.locator('#first');
  const waitQuality = active => page.waitForFunction(active => {
    const state = window.demo.players[0].state;
    return state.quality.active === active && state.quality.pending === null && state.phase === 'paused';
  }, active);
  const geometry = async () => {
    await expect(first.locator('#volume')).toBeVisible();
    const result = await first.locator('.player').evaluate(player => {
      const root = player.getRootNode();
      const views = root.querySelector('#views').getBoundingClientRect();
      const overlay = root.querySelector('.visual-controls');
      const dashboard = root.querySelector('.dashboard').getBoundingClientRect();
      const box = overlay.getBoundingClientRect();
      const controls = ['quality', 'quality-retry', 'mute', 'volume', 'fullscreen']
        .map(id => root.getElementById(id)).filter(control => control.getBoundingClientRect().width > 0);
      const rects = controls.map(control => control.getBoundingClientRect());
      const status = root.getElementById('quality-status');
      const statusStyle = getComputedStyle(status);
      const label = root.getElementById('quality-control');
      const narrow = player.clientWidth <= 700;
      const inset = narrow ? 8 : 12;
      const mode = root.getElementById('mode').getBoundingClientRect();
      return {
        stable: overlay.parentElement.id === 'views',
        contained: rects.every(rect => {
          return rect.width > 0 && rect.height > 0 && rect.left >= views.left && rect.right <= views.right
            && rect.top >= views.top && rect.bottom <= views.bottom;
        }),
        aboveDashboard: box.bottom <= dashboard.top,
        bottomRight: Math.abs(views.right - box.right - (narrow ? 8 : 16)) < 1
          && Math.abs(views.bottom - box.bottom - inset) < 1,
        matchedTopInset: Math.abs(views.bottom - box.bottom - (mode.top - views.top)) <= 4,
        singleRow: rects.every(rect => Math.abs(rect.top + rect.height / 2 - (box.top + box.height / 2)) < 1)
          && Math.abs(box.height - Math.max(...rects.map(rect => rect.height))) < 1,
        noBlankColumn: Math.abs(rects[0].left - box.left) < 1,
        noVisibleLabel: [...label.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
          .every(node => !node.textContent.trim()),
        nonvisualStatus: statusStyle.position === 'absolute' && statusStyle.clipPath === 'inset(50%)'
          && status.getBoundingClientRect().width <= 1 && status.getBoundingClientRect().height <= 1
          && statusStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && statusStyle.padding === '0px',
        liveStatus: status.getAttribute('role') === 'status' && status.getAttribute('aria-live') === 'polite'
          && statusStyle.display !== 'none' && statusStyle.visibility === 'visible',
        timingOnly: !root.querySelector('.dashboard #quality, .dashboard #mute, .dashboard #volume, .dashboard #fullscreen'),
        dashboardHeight: dashboard.height,
      };
    });
    assert.deepEqual(result, {stable: true, contained: true, aboveDashboard: true, bottomRight: true,
      matchedTopInset: true, singleRow: true, noBlankColumn: true, noVisibleLabel: true,
      nonvisualStatus: true, liveStatus: true, timingOnly: true, dashboardHeight: 235});
  };
  const screenshot = name => first.screenshot({path: join(screenshots, name + '.png')});
  await waitQuality('economy');
  await expect(first.getByRole('combobox', {name: 'Video quality', exact: true})).toBeVisible();
  await geometry();
  await expect(first.locator('#opacity')).toBeVisible();
  await expect(first.locator('#opacity')).toBeEnabled();
  await first.locator('#opacity').fill('0.6');
  await expect(first.locator('#map')).toHaveCSS('opacity', '0.6');
  await first.locator('#quality').selectOption('detail');
  await waitQuality('detail');
  await expect(first.locator('#quality-status')).toContainText('Playing Fine view');
  await expect(first.locator('video')).toHaveAttribute('src', /demo\.webm\?detail$/);
  assert.equal(await first.locator('video').evaluate(video => video.readyState >= 2 && video.videoWidth > 0), true);
  await geometry();
  await first.locator('#mute').click();
  assert.equal(await first.locator('video').evaluate(video => video.muted), false);
  await first.locator('#volume').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => first.locator('video').evaluate(video => video.volume)).toBe(0.05);
  await first.locator('#mute').click();
  assert.equal(await first.locator('video').evaluate(video => video.muted), true);
  await screenshot('desktop-video-main');
  await first.locator('#swap').click();
  await expect.poll(() => page.evaluate(() => window.demo.players[0].state.mainView)).toBe('map');
  await geometry();
  await screenshot('desktop-map-main');
  await first.locator('#mode').click();
  await expect.poll(() => page.evaluate(() => window.demo.players[0].state.mode)).toBe('hud');
  await geometry();
  await expect(first.locator('#notice')).not.toContainText('HUD is a GPS chase-camera visualization');
  await expect(first.locator('#opacity')).toBeHidden();
  await expect(first.locator('.map-options label')).toBeHidden();
  await screenshot('desktop-hud');
  await first.locator('#mode').click();
  await expect(first.locator('#opacity')).toBeVisible();
  await expect(first.locator('.map-options label')).toBeVisible();
  await first.locator('#fullscreen').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await geometry();
  await screenshot('fullscreen');
  await first.locator('#fullscreen').click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.setViewportSize({width: 360, height: 700});
  await page.evaluate(() => document.querySelector('#first').style.cssText = 'width:320px;height:480px');
  await geometry();
  await first.locator('#volume').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => first.locator('video').evaluate(video => video.volume)).toBe(0.95);
  await first.locator('#quality').selectOption('economy');
  await waitQuality('economy');
  await expect(first.locator('video')).toHaveAttribute('src', /demo\.webm$/);
  assert.deepEqual(await first.locator('video').evaluate(video => ({muted: video.muted, volume: video.volume,
    decoded: video.readyState >= 2 && video.videoWidth > 0})), {muted: false, volume: 0.95, decoded: true});
  await geometry();
  await screenshot('narrow-map-main');
  await first.locator('#swap').click();
  await geometry();
  await screenshot('narrow-video-main');
  await first.locator('#mode').click();
  await geometry();
  await screenshot('narrow-hud');
  await first.locator('#mode').click();
  await first.locator('#fullscreen').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await geometry();
  await screenshot('narrow-fullscreen');
  await first.locator('#fullscreen').click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.evaluate(async () => {
    window.windowControlsFail = true;
    await window.demo.players[0].load(window.windowControlsManifest, {
      baseUrl: new URL('/fixtures/regression/manifest.json', location.href).href,
      resolveSource: request => request.quality === 'detail' && window.windowControlsFail
        ? {status: 'failed', message: 'Synthetic unavailable source', retryable: true}
        : {status: 'source', source: {quality: request.quality,
          url: new URL('/fixtures/regression/demo.webm', location.href).href, mediaStartSeconds: 1}},
    });
  });
  await waitQuality('economy');
  await first.locator('#quality').selectOption('detail');
  await expect(first.locator('#quality-retry')).toBeVisible();
  await expect(first.locator('#quality-status')).toContainText('Could not apply');
  await geometry();
  await screenshot('narrow-quality-failure');
  await page.evaluate(() => {window.windowControlsFail = false;});
  await first.locator('#quality-retry').click();
  await waitQuality('detail');
  await expect(first.locator('#quality-retry')).toBeHidden();
  await geometry();
  const multipleWidth = await first.locator('.visual-controls').evaluate(group => group.getBoundingClientRect().width);
  await page.evaluate(async () => {
    const manifest = structuredClone(window.windowControlsManifest);
    manifest.qualities.options = [{id: 'economy', label: 'Data saver'}];
    manifest.clips = manifest.clips.map(clip => ({...clip, sources: {economy: clip.sources.economy}}));
    await window.demo.players[0].load(manifest, {baseUrl: new URL('/fixtures/regression/manifest.json', location.href).href});
  });
  await waitQuality('economy');
  await expect(first.locator('#quality')).toBeHidden();
  await geometry();
  const singleWidth = await first.locator('.visual-controls').evaluate(group => group.getBoundingClientRect().width);
  assert.ok(singleWidth < multipleWidth - 40, `Single-quality group must shrink: ${singleWidth} < ${multipleWidth} - 40`);
  await screenshot('narrow-single-quality');
  await page.setViewportSize({width: 1280, height: 900});
  await page.evaluate(() => document.querySelector('#first').style.cssText = 'width:1100px;height:660px');
  await geometry();
  await screenshot('desktop-single-quality');
  await page.evaluate(() => window.demo.players.forEach(player => player.destroy()));
  assert.deepEqual(errors, []);
  console.log(`Window controls passed in both main views, HUD, fullscreen and 320px width at 480px height. Screenshots saved to ${screenshots}`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
