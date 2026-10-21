import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir, networkInterfaces} from 'node:os';
import {join} from 'node:path';
import {createDemoServer} from './server.mjs';

const directory = await mkdtemp(join(tmpdir(), 'gps-quality-'));
const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, '-y'], {stdio: 'pipe'});
let browser, server, demo;
try {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12:duration=24', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=24', '-c:v', 'libvpx', '-b:v', '220k', '-c:a', 'libopus', join(directory, 'saver.webm')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=12:duration=24', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(directory, 'detail.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(directory, 'high-detail.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=24', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=24', '-c:v', 'libx265', '-x265-params', 'pools=1:frame-threads=1:log-level=error', '-tag:v', 'hvc1', '-c:a', 'aac', '-movflags', '+faststart', join(directory, 'no-decode.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=24', '-c:a', 'aac', '-movflags', '+faststart', join(directory, 'audio.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=4.7', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(directory, 'short.mp4')]);
  const bodies = new Map(await Promise.all([
    ['/quality/first', 'saver.webm', 'video/webm'], ['/quality/cdn/other', 'detail.mp4', 'video/mp4'],
    ['/quality/no-decode', 'no-decode.mp4', 'video/mp4'], ['/quality/audio', 'audio.mp4', 'video/mp4'],
    ['/quality/high-detail', 'high-detail.mp4', 'video/mp4'], ['/quality/short', 'short.mp4', 'video/mp4'],
  ].map(async ([path, file, type]) => [path, {body: await readFile(join(directory, file)), type}])));
  const requests = [], signs = [];
  demo = createDemoServer();
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://test'); requests.push({path: url.pathname, query: url.search, auth: req.headers.authorization ?? null});
    if (url.pathname === '/quality/sign') {
      signs.push(url.searchParams.get('quality'));
      if (req.headers.authorization !== 'Bearer fixture-access') {res.writeHead(403).end(); return;}
      const path = url.searchParams.get('expired') === 'yes' ? '/quality/expired' : url.searchParams.get('quality') === 'detail' ? '/quality/cdn/other' : '/quality/first';
      res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({url: `${path}?fresh=${signs.length}`})); return;
    }
    if (url.pathname === '/quality/expired') {res.writeHead(404).end(); return;}
    if (url.pathname === '/quality/not-ready') {
      res.writeHead(200, {'Content-Type': 'video/mp4', 'Content-Length': 100000}); res.flushHeaders(); return;
    }
    if (url.pathname === '/quality.html' || url.pathname === '/quality-page.js') {
      const html = url.pathname.endsWith('.html');
      res.writeHead(200, {'Content-Type': html ? 'text/html' : 'text/javascript', ...(url.searchParams.has('blocked') ? {'Permissions-Policy': 'autoplay=()'} : {})}).end(await readFile(new URL(html ? './quality.html' : './quality-page.js', import.meta.url))); return;
    }
    const resource = bodies.get(url.pathname);
    if (!resource) {demo.emit('request', req, res); return;}
    const {body, type} = resource, headers = {'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'};
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = Math.min(Number(range[2] || body.length - 1), body.length - 1);
      if (start > end) {res.writeHead(416).end(); return;}
      res.writeHead(206, {...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1}).end(body.subarray(start, end + 1));
    } else res.writeHead(200, {...headers, 'Content-Length': body.length}).end(body);
  });
  server.listen(0, '0.0.0.0'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({channel: 'chromium', ignoreDefaultArgs: ['--mute-audio'], executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=document-user-activation-required']});
  const page = await browser.newPage({viewport: {width: 1200, height: 950}}), errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(base) || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
  await page.goto(base + '/quality.html');
  await page.waitForFunction(() => window.qa?.ready && window.qa.players.every(p => p.state?.phase === 'paused' && p.state.mapReady));
  const first = page.locator('#first'), second = page.locator('#second');
  const state = index => page.evaluate(i => window.qa.players[i].state, index);
  const wait = (active, elapsed = null) => page.waitForFunction(({active, elapsed}) => {
    const s = window.qa.players[0].state;
    return s?.quality?.active === active && s.quality.pending === null && (elapsed === null || s.elapsed === elapsed);
  }, {active, elapsed});
  const load = async () => {
    await page.evaluate(() => window.qa.players[0].load(window.qa.manifest(), {baseUrl: location.href}));
    await wait('economy', 0);
  };
  await page.evaluate(() => {window.qa.players[0].seek(3.25); window.qa.players[0].setNudge(1.5);});
  await page.waitForFunction(() => window.qa.players[0].state.phase === 'paused' && window.qa.players[0].state.mediaTime === 5.25);
  await expect(first.locator('#quality')).toHaveAttribute('aria-label', 'Video quality');
  await expect(first.locator('#quality-status')).toHaveAttribute('role', 'status');
  await first.locator('#quality').focus(); await page.keyboard.press('End');
  await wait('detail', 3.25);
  assert.equal((await state(0)).mediaTime, 10.25);
  assert.equal((await state(0)).utc, Date.parse('2030-01-01T23:59:55Z') / 1000 + 4.75);
  assert.equal(await first.locator('video').evaluate(v => v.videoWidth), 480);
  assert.ok((await first.locator('video').getAttribute('src')).endsWith('/quality/cdn/other?sig=arbitrary'));
  assert.equal((await state(1)).quality.requested, 'economy');
  assert.equal(await first.locator('#quality').evaluate(e => getComputedStyle(e).outlineStyle), 'solid');
  await page.keyboard.press('Space'); await page.keyboard.press('Escape');
  await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  await wait('economy', 3.25);
  assert.equal((await state(0)).playing, false);
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await first.locator('#quality').evaluate(e => e.getRootNode().activeElement === e), true);
  assert.equal(signs.length, 0);
  assert.ok(requests.some(r => r.query === '?sig=%7Bx%7D&a=a+b'));
  console.log('1, 3, 8 static sources, literal offsets, labels, native keyboard and independent players passed.');

  await first.locator('#fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement !== null);
  await first.locator('#quality').selectOption('detail'); await wait('detail', 3.25);
  assert.equal(await page.evaluate(() => document.fullscreenElement === document.getElementById('first').firstElementChild), true);
  await first.locator('#mode').click(); await first.locator('#quality').selectOption('economy'); await wait('economy');
  assert.equal((await state(0)).mode, 'hud');
  await first.locator('#fullscreen').click(); await page.waitForFunction(() => !document.fullscreenElement);
  await page.setViewportSize({width: 320, height: 950});
  const bounds = await first.locator('#quality').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  const statusBounds = await first.locator('#quality-status').boundingBox(); assert.ok(statusBounds.width > 0 && statusBounds.x + statusBounds.width <= 320);
  await first.locator('#quality').selectOption('detail'); await wait('detail');
  await expect(first.locator('#quality-status')).toContainText('Playing Fine view.');
  await page.setViewportSize({width: 1200, height: 950});
  await first.locator('#mode').click();

  for (const mode of ['resume', 'switch']) {
    await page.evaluate(async () => {
      const qa = window.qa, manifest = qa.manifest();
      manifest.clips = [{...manifest.clips[0], durationSeconds: 15, sources: {
        economy: manifest.clips[0].sources.economy,
        detail: {url: '/quality/high-detail', type: 'video/mp4'},
      }}];
      await qa.players[0].load(manifest, {baseUrl: location.href});
    });
    await wait('economy', 0);
    await page.evaluate(() => window.qa.players[0].seek(3.25)); await wait('economy', 3.25);
    if (mode === 'resume') {
      assert.equal((await page.evaluate(() => window.qa.players[0].selectQuality('detail'))).active, 'detail');
    }
    await page.evaluate(mode => {
      const qa = window.qa, p = qa.players[0], play = HTMLMediaElement.prototype.play;
      qa.playAck = null; qa.playingMedia = null;
      qa.restorePlay = () => {HTMLMediaElement.prototype.play = play;};
      HTMLMediaElement.prototype.play = function() {
        if (this.videoWidth !== 1920) return play.call(this);
        qa.playingMedia = this; qa.playTarget = this.currentTime;
        return play.call(this).then(() => new Promise(done => {qa.playAck = done;}));
      };
      qa.qualityAck = mode === 'switch' ? p.selectQuality('detail') : null;
      p.play();
    }, mode);
    await page.waitForFunction(() => window.qa.playAck && window.qa.playingMedia.currentTime > window.qa.playTarget + .15);
    const pending = await state(0);
    assert.deepEqual([pending.quality.active, pending.quality.pending, pending.elapsed], [mode === 'resume' ? 'detail' : 'economy', 'detail', 3.25]);
    assert.equal(await page.evaluate(() => window.qa.playingMedia.videoHeight), 1080);
    await page.evaluate(() => window.qa.playAck());
    await page.waitForFunction(() => !window.qa.players[0].state.quality.pending);
    if (mode === 'switch') {
      const ack = await page.evaluate(() => window.qa.qualityAck);
      assert.deepEqual([ack.status, ack.active, ack.playing], ['applied', 'detail', true]);
    }
    const resumed = await state(0);
    assert.deepEqual([resumed.quality.active, resumed.phase, resumed.quality.outcome.status, resumed.quality.outcome.reason], ['detail', 'playing', 'applied', null]);
    await page.waitForFunction(() => window.qa.players[0].state.elapsed > 3.5);
    await page.evaluate(() => {window.qa.restorePlay(); window.qa.players[0].pause();});
  }
  console.log('High-resolution 1920x1080 resume and switch passed after real media advanced before delayed play acknowledgement.');
  await load();
  await page.evaluate(() => window.qa.players[0].selectQuality('detail')); await wait('detail');

  await page.evaluate(async () => {
    const p = window.qa.players[0]; p.seek(6);
    window.qa.gapAck = await p.selectQuality('detail');
  });
  assert.equal(await page.evaluate(() => window.qa.gapAck.status), 'deferred');
  assert.equal(await first.locator('video').count(), 0);
  await page.evaluate(() => window.qa.players[0].seek(9)); await wait('economy', 9);
  assert.deepEqual([(await state(0)).quality.requested, (await state(0)).quality.outcome.outcome, (await state(0)).quality.outcome.reason], ['detail', 'fallback', 'unavailable']);
  await expect(first.locator('#quality option[value=detail]')).toContainText('not available for this clip');
  await page.evaluate(() => window.qa.players[0].seek(16)); await wait('detail', 16);
  console.log('4 gap preference, clip availability and preference restoration passed.');

  await load();
  await page.evaluate(() => {window.qa.players[0].seek(2); window.qa.players[0].setRate(1.5);});
  await wait('economy', 2);
  await page.evaluate(() => window.qa.players[0].play());
  await page.waitForFunction(() => window.qa.players[0].state.elapsed > 2.1);
  const playingTarget = await page.evaluate(() => {
    window.qa.playingAck = window.qa.players[0].selectQuality('detail');
    return window.qa.players[0].state.elapsed;
  });
  const playingAck = await page.evaluate(() => window.qa.playingAck);
  assert.deepEqual([playingAck.status, playingAck.active, playingAck.playing], ['applied', 'detail', true]);
  const playingState = await state(0);
  assert.ok(Math.abs(playingState.mediaTime - (playingTarget + 7)) < .3);
  assert.ok(Math.abs(playingState.elapsed - playingTarget) < .3);
  assert.equal(playingState.rate, 1.5);
  await page.evaluate(() => window.qa.players[0].pause());

  await page.evaluate(async () => {
    const qa = window.qa;
    qa.signRequests = []; qa.expired = true;
    await qa.players[0].load(qa.manifest(), {baseUrl: location.href, qualities: qa.catalogue(1), resolveSource: async request => {
      qa.signRequests.push({load: request.load, request: request.request, localTime: request.localTime});
      const response = await fetch(`/quality/sign?quality=${request.quality}&expired=${qa.expired ? 'yes' : 'no'}`, {headers: {Authorization: 'Bearer fixture-access'}, signal: request.signal});
      return {status: 'source', source: {quality: request.quality, url: new URL((await response.json()).url, location.href).href, mediaStartSeconds: 2}};
    }});
  });
  await page.waitForFunction(() => window.qa.players[0].state.phase === 'error');
  const expiredLoad = (await state(0)).load;
  await page.evaluate(() => {window.qa.expired = false; window.qa.players[0].play();});
  await page.waitForFunction(() => window.qa.players[0].state.phase === 'playing');
  await page.evaluate(() => window.qa.players[0].pause());
  assert.equal((await state(0)).load, expiredLoad);
  const ids = await page.evaluate(() => window.qa.signRequests.map(r => r.request)); assert.equal(new Set(ids).size, 3);
  assert.ok((await first.locator('video').getAttribute('src')).includes('?fresh=3'));
  assert.equal(requests.filter(r => r.path !== '/quality/sign' && r.auth).length, 0);
  console.log('2 authenticated per-load resolver, expired transport and fresh retry passed.');

  await page.evaluate(async () => {
    const qa = window.qa; qa.delayed = [];
    await qa.players[0].load(qa.manifest(), {baseUrl: location.href, qualities: qa.catalogue(1), resolveSource: request => new Promise(done => qa.delayed.push({request, done}))});
    qa.one = qa.players[0].selectQuality('detail'); qa.duplicate = qa.players[0].selectQuality('detail');
  });
  await expect.poll(() => page.evaluate(() => window.qa.delayed.length)).toBe(2);
  await page.evaluate(() => {window.qa.players[0].seek(3.25); window.qa.players[0].pause();});
  await expect.poll(() => page.evaluate(() => window.qa.delayed.length)).toBe(3);
  assert.deepEqual(await page.evaluate(async () => [(await window.qa.one).status, (await window.qa.duplicate).reason]), ['cancelled', 'superseded']);
  await page.evaluate(async () => {
    for (const item of window.qa.delayed.slice(0, 2)) item.done(await window.qa.blobSource(item.request));
    window.qa.delayed[2].done(await window.qa.blobSource(window.qa.delayed[2].request));
  });
  await wait('detail', 3.25);
  assert.equal((await state(0)).mediaTime, 10.25);
  assert.equal((await state(0)).phase, 'paused');
  assert.deepEqual(await page.evaluate(() => [window.qa.owned.size, window.qa.released.length]), [1, 2]);
  await page.evaluate(() => {window.qa.two = window.qa.players[0].selectQuality('economy');});
  await expect.poll(() => page.evaluate(() => window.qa.delayed.length)).toBe(4);
  await load();
  assert.equal(await page.evaluate(async () => (await window.qa.two).reason), 'load');
  await page.evaluate(async () => window.qa.delayed[3].done(await window.qa.blobSource(window.qa.delayed[3].request)));
  await expect.poll(() => page.evaluate(() => window.qa.owned.size)).toBe(0);
  assert.equal((await state(0)).quality.requested, 'economy');
  console.log('5 out-of-order resolver completion, duplicate calls, seek, pause, load and blob ownership passed.');
  await page.evaluate(async () => {
    const qa = window.qa, p = qa.players[0], previousLoad = p.state.load;
    const manifest = qa.manifest(); manifest.qualities.default = 'detail';
    await p.load(manifest, {baseUrl: location.href});
    qa.staleUpdate = p.updateQualities(previousLoad, qa.catalogue(5));
  });
  await wait('detail', 0);
  assert.equal((await state(0)).quality.requested, 'detail');
  assert.equal(await page.evaluate(() => window.qa.staleUpdate.reason), 'stale-load');
  await page.evaluate(() => {
    const qa = window.qa;
    return qa.players[0].load({version: 1, track: qa.manifest().track, clips: []}, {baseUrl: location.href});
  });
  assert.equal((await state(0)).quality, null);
  await expect(first.locator('#quality-row')).toBeHidden();

  await page.evaluate(async () => {
    const qa = window.qa;
    await qa.players[0].load(qa.manifest(), {baseUrl: location.href, qualities: qa.catalogue(1), resolveSource: qa.blobSource});
  });
  await wait('economy');
  await page.evaluate(() => {
    const qa = window.qa; qa.gates = [];
    qa.players[0].load(qa.manifest(), {baseUrl: location.href, qualities: qa.catalogue(1), resolveSource: async request => {
      if (request.quality === 'detail') return new Promise(done => qa.gates.push({request, done}));
      return qa.blobSource(request);
    }}).then(() => {qa.three = qa.players[0].selectQuality('detail');});
  });
  await expect.poll(() => page.evaluate(() => window.qa.gates.length)).toBe(1);
  await page.evaluate(() => {
    const qa = window.qa, p = qa.players[0]; qa.oldLoad = p.state.load;
    qa.update = p.updateQualities(qa.oldLoad, {revision: 2, options: [{id: 'economy', label: 'Saver'}], default: 'economy', fallback: []});
  });
  assert.equal(await page.evaluate(async () => (await window.qa.three).reason), 'removed');
  await wait('economy');
  await page.evaluate(async () => window.qa.gates[0].done(await window.qa.blobSource(window.qa.gates[0].request)));
  await expect.poll(() => page.evaluate(() => window.qa.owned.size)).toBe(1);
  await page.evaluate(() => {
    const qa = window.qa, p = qa.players[0]; qa.releaseBefore = qa.released.length;
    p.updateQualities(p.state.load, {revision: 3, options: [{id: 'detail', label: 'Detail'}], default: 'detail', fallback: []});
  });
  await expect.poll(() => page.evaluate(() => window.qa.gates.length)).toBe(2);
  assert.deepEqual(await page.evaluate(() => [window.qa.players[0].state.quality.active, window.qa.released.length === window.qa.releaseBefore, document.querySelector('#first').firstElementChild.shadowRoot.querySelectorAll('video').length]), ['economy', true, 1]);
  await page.evaluate(async () => window.qa.gates[1].done(await window.qa.blobSource(window.qa.gates[1].request)));
  await wait('detail');
  assert.equal(await page.evaluate(() => window.qa.released.length), await page.evaluate(() => window.qa.releaseBefore + 1));
  console.log('6 catalogue revision cancellation and no early release of removed active quality passed.');

  await load();
  await page.evaluate(async () => {
    const qa = window.qa, p = qa.players[0];
    qa.restoreRequests = [];
    await p.load(qa.manifest(), {baseUrl: location.href, qualities: qa.catalogue(1), resolveSource: request => {
      qa.restoreRequests.push(request.quality);
      return request.quality === 'economy' ? qa.blobSource(request)
        : {status: 'source', source: {quality: request.quality, url: new URL('/quality/expired', location.href).href}};
    }});
  });
  await wait('economy');
  const restored = await page.evaluate(() => window.qa.players[0].selectQuality('detail'));
  assert.deepEqual([restored.status, restored.active, restored.reason], ['failed', 'economy', 'media-failed']);
  assert.equal(await first.locator('video').count(), 1);
  await expect(first.locator('#quality-status')).toContainText('Could not apply Fine view. Playing Data saver.');
  await expect(first.locator('#quality-retry')).toBeVisible();
  await page.evaluate(() => window.qa.players[0].play());
  await page.waitForFunction(() => window.qa.players[0].state.phase === 'playing');
  await page.evaluate(() => {window.qa.players[0].pause(); window.qa.players[0].play();});
  await page.waitForFunction(() => window.qa.players[0].state.phase === 'playing');
  assert.deepEqual(await page.evaluate(() => window.qa.restoreRequests), ['economy', 'detail']);
  assert.deepEqual([(await state(0)).quality.outcome.reason, (await state(0)).error], ['media-failed', null]);
  await page.evaluate(async () => {window.qa.players[0].pause(); await window.qa.players[0].selectQuality('economy');});
  const reusedUrl = await first.locator('video').getAttribute('src');
  for (const elapsed of [1, 2, 3.25]) {
    await page.evaluate(elapsed => window.qa.players[0].seek(elapsed), elapsed); await wait('economy', elapsed);
    assert.equal((await state(0)).mediaTime, elapsed + 2);
  }
  assert.equal(await first.locator('video').getAttribute('src'), reusedUrl);
  assert.deepEqual(await page.evaluate(() => window.qa.restoreRequests), ['economy', 'detail']);
  console.log('F1, F3, F6 restored failures resume without acquisition; same-clip seeks retain the resource and exact position.');

  await page.evaluate(async () => {
    const qa = window.qa, p = qa.players[0]; qa.busy = true; qa.fallbackRequests = [];
    await p.load(qa.manifest(), {baseUrl: location.href, qualities: {...qa.catalogue(1), default: 'detail'}, resolveSource: request => {
      qa.fallbackRequests.push(request.quality);
      return qa.busy && request.quality === 'detail' ? {status: 'failed', message: 'Busy.', retryable: true} : qa.blobSource(request);
    }});
  });
  await wait('economy', 0);
  assert.deepEqual([(await state(0)).quality.requested, (await state(0)).quality.outcome.reason], ['detail', 'resolver-failed']);
  await expect(first.locator('#quality-retry')).toBeVisible();
  await page.evaluate(() => {window.qa.busy = false;});
  await first.locator('#quality-retry').click(); await wait('detail', 0);
  assert.deepEqual(await page.evaluate(() => window.qa.fallbackRequests), ['detail', 'economy', 'detail']);
  console.log('F5 transient fallback offers a working native Retry button.');

  await page.evaluate(async () => {
    const qa = window.qa, p = qa.players[0]; qa.availabilityRequests = [];
    await p.load(qa.manifest(), {baseUrl: location.href, qualities: {...qa.catalogue(1), default: 'detail', availability: [{detail: 'unavailable'}]}, resolveSource: request => {
      qa.availabilityRequests.push(request.quality); return qa.blobSource(request);
    }});
  });
  await wait('economy', 0);
  await expect(first.locator('#quality-retry')).toBeHidden();
  await page.evaluate(() => {
    const qa = window.qa, p = qa.players[0];
    p.updateQualities(p.state.load, {...qa.catalogue(2), default: 'detail', availability: [{detail: 'available'}]});
  });
  assert.deepEqual([(await state(0)).quality.active, (await state(0)).quality.pending, await page.evaluate(() => window.qa.availabilityRequests)], ['economy', null, ['economy']]);
  await expect(first.locator('#quality-retry')).toBeVisible();
  await first.locator('#quality-retry').click(); await wait('detail', 0);
  assert.deepEqual(await page.evaluate(() => window.qa.availabilityRequests), ['economy', 'detail']);
  console.log('F9 availability does not interrupt healthy playback; explicit Retry applies the preference.');

  await page.evaluate(async () => {
    const qa = window.qa, p = qa.players[0]; qa.revisionRequests = [];
    await p.load(qa.manifest(), {baseUrl: location.href, qualities: qa.catalogue(1), resolveSource: request => {
      qa.revisionRequests.push([request.revision, request.quality]);
      if (request.revision > 1) return {status: 'failed', message: 'Busy.', retryable: true};
      if (request.quality === 'detail') return new Promise(done => {qa.oldRevision = {request, done};});
      return qa.blobSource(request);
    }});
  });
  await wait('economy', 0);
  const rollbackUrl = await first.locator('video').getAttribute('src');
  await page.evaluate(() => {window.qa.revisionAck = window.qa.players[0].selectQuality('detail');});
  await page.waitForFunction(() => window.qa.oldRevision);
  await page.evaluate(() => {const qa = window.qa, p = qa.players[0]; p.updateQualities(p.state.load, qa.catalogue(2));});
  assert.deepEqual(await page.evaluate(async () => {const ack = await window.qa.revisionAck; return [ack.status, ack.reason, ack.revision];}), ['cancelled', 'superseded', 1]);
  await wait('economy', 0);
  assert.deepEqual([(await state(0)).phase, (await state(0)).quality.outcome.status, (await state(0)).quality.outcome.revision], ['paused', 'failed', 2]);
  assert.equal(await first.locator('video').getAttribute('src'), rollbackUrl);
  assert.deepEqual(await page.evaluate(() => window.qa.revisionRequests), [[1, 'economy'], [1, 'detail'], [2, 'detail']]);
  await page.evaluate(() => window.qa.oldRevision.done({status: 'failed', message: 'Busy.', retryable: true}));
  console.log('F2 revision cancellation preserves supported rollback media after fresh resolution fails.');

  await page.evaluate(async () => {
    const qa = window.qa, p = qa.players[0]; qa.reentrant = [];
    const listener = event => {
      qa.reentrant.push(event.detail.quality.revision);
      if (event.detail.quality.revision === 3) {
        p.updateQualities(p.state.load, qa.catalogue(4));
        qa.reentrantAck = p.selectQuality('economy');
      }
    };
    p.on('qualitycatalogue', listener);
    p.updateQualities(p.state.load, {revision: 3, options: [{id: 'detail', label: 'Detail'}], default: 'detail', fallback: []});
    p.off('qualitycatalogue', listener);
    await qa.reentrantAck;
  });
  await wait('economy', 0);
  assert.deepEqual(await page.evaluate(() => [window.qa.reentrant, window.qa.players[0].state.quality.revision]), [[3, 4], 4]);
  console.log('F11 reentrant catalogue update and selection retain the latest revision and choice.');

  for (const elapsed of [0, 4.9]) {
    if (elapsed === 0) await page.evaluate(async () => {
      const qa = window.qa, manifest = qa.manifest(); manifest.clips = [manifest.clips[0]];
      await qa.players[0].load(manifest, {baseUrl: location.href, qualities: {...qa.catalogue(1), fallback: []}, resolveSource: request =>
        ({status: 'source', source: {quality: request.quality, url: new URL('/quality/short', location.href).href}})});
    });
    else await page.evaluate(() => window.qa.players[0].seek(4.9));
    await page.waitForFunction(() => window.qa.players[0].state.phase === 'error');
    assert.deepEqual([(await state(0)).elapsed, (await state(0)).quality.active, (await state(0)).quality.outcome.reason], [elapsed, null, 'mapping-failed']);
  }
  console.log('F4 real 4.7-second media cannot satisfy a 5-second interval at either early or late targets.');

  await page.evaluate(async () => {
    const qa = window.qa;
    await qa.players[0].load({version: 1, track: qa.manifest().track, clips: [{startUtc: '2030-01-01T23:59:55Z', durationSeconds: 5, url: '/quality/audio'}]}, {baseUrl: location.href});
  });
  await page.waitForFunction(() => window.qa.players[0].state.phase === 'error');
  await expect(first.locator('#quality-row')).toBeHidden();
  await expect(first.locator('#video-status')).toContainText('Press Play to retry.');
  await page.evaluate(() => window.qa.players[0].play());
  await page.waitForFunction(() => window.qa.players[0].state.phase === 'error');
  assert.equal((await state(0)).quality.outcome.reason, 'media-failed');
  console.log('F10 fixed-source quality controls stay hidden on error; Play still retries.');

  await page.evaluate(async () => {
    const qa = window.qa;
    await qa.players[0].load(qa.manifest(), {baseUrl: location.href, qualities: {revision: 1, options: [{id: 'auto', label: 'Auto', mode: 'auto'}, {id: 'economy', label: 'Saver'}], default: 'auto', fallback: []}, resolveSource: qa.blobSource});
  });
  await page.waitForFunction(() => window.qa.players[0].state.phase === 'error');
  await expect(first.locator('#quality-retry')).toBeHidden();
  await first.locator('#quality').selectOption('economy'); await wait('economy', 0);
  console.log('F7 unsupported preferences have no dead Retry button; a supported choice still works.');

  for (const mode of ['resolver', 'static', 'v1']) {
    await page.evaluate(async mode => {
      const qa = window.qa, manifest = qa.manifest(); manifest.clips = [manifest.clips[0]];
      const owner = new class {
        url = '/quality/first'; mediaStartSeconds = 2; #releases = 0;
        get releases() { return this.#releases; }
        release() { this.#releases++; }
      }();
      qa.releaseOwner = owner;
      if (mode === 'static') manifest.clips[0].sources.economy = owner;
      if (mode === 'v1') {
        Object.assign(owner, {startUtc: manifest.clips[0].startUtc, durationSeconds: 5, mediaOffsetSeconds: 2});
        await qa.players[0].load({version: 1, track: manifest.track, clips: [owner]}, {baseUrl: location.href});
      } else await qa.players[0].load(manifest, {baseUrl: location.href,
        ...(mode === 'resolver' ? {qualities: qa.catalogue(1), resolveSource: request => {
          owner.quality = request.quality; owner.url = new URL('/quality/first', location.href).href;
          return {status: 'source', source: owner};
        }} : {})});
    }, mode);
    await wait(mode === 'v1' ? 'original' : 'economy', 0);
    await page.evaluate(() => window.qa.players[0].seek(6));
    assert.equal(await page.evaluate(() => window.qa.releaseOwner.releases), 1);
  }
  console.log('F12 resolver, static v2 and fixed v1 release methods retain their original descriptor receiver.');

  for (const mode of ['rejection', 'timeout', 'ready-timeout', 'format', 'audio']) {
    await page.evaluate(async mode => {
      const qa = window.qa, p = qa.players[0], cat = {...qa.catalogue(1), fallback: []};
      qa.failureRequests = 0;
      await p.load(qa.manifest(), {baseUrl: location.href, qualities: cat, resolveSource: request => {
        ++qa.failureRequests;
        if (mode === 'rejection') throw new Error('https://private.invalid/?token=unsafe');
        if (mode === 'timeout') return new Promise(() => {});
        return {status: 'source', source: {quality: request.quality, url: new URL(mode === 'audio' ? '/quality/audio' : mode === 'ready-timeout' ? '/quality/not-ready' : '/quality/no-decode', location.href).href,
          ...(mode === 'format' ? {type: 'video/not-supported'} : {})}};
      }});
    }, mode);
    await page.waitForFunction(() => window.qa.players[0].state.phase === 'error');
    const s = await state(0);
    assert.equal(s.elapsed, 0); assert.equal(s.quality.active, null); assert.equal(s.quality.outcome.status, 'failed');
    assert.equal(await page.evaluate(() => window.qa.failureRequests), 1);
    assert.equal(s.quality.outcome.reason, mode === 'rejection' ? 'resolver-failed' : mode.includes('timeout') ? 'timeout' : mode === 'format' ? 'unsupported' : 'media-failed');
    assert.equal(JSON.stringify(s).includes('private.invalid'), false);
  }
  const hevcDecoded = await page.evaluate(() => new Promise(resolve => {
    const video = document.createElement('video'); video.muted = true; video.preload = 'auto';
    const finish = () => {clearTimeout(timer); const decoded = video.readyState >= 3 && video.videoWidth > 0; video.removeAttribute('src'); video.load(); resolve(decoded);};
    const timer = setTimeout(finish, 5000);
    video.addEventListener('canplay', finish, {once: true}); video.addEventListener('error', finish, {once: true});
    video.src = '/quality/no-decode'; video.load();
  }));
  await page.evaluate(() => {
    const qa = window.qa;
    return qa.players[0].load(qa.manifest(), {baseUrl: location.href, qualities: {...qa.catalogue(1), fallback: []}, resolveSource: request =>
      ({status: 'source', source: {quality: request.quality, url: new URL('/quality/no-decode', location.href).href}})});
  });
  await page.waitForFunction(() => !window.qa.players[0].state.quality.pending);
  const hevcState = await state(0);
  assert.deepEqual([hevcState.phase, hevcState.quality.active, hevcState.quality.outcome.status, hevcState.quality.outcome.reason],
    hevcDecoded ? ['paused', 'economy', 'applied', null] : ['error', null, 'failed', 'media-failed']);
  if (hevcDecoded) assert.equal(await first.locator('video').evaluate(video => video.videoWidth), 160);
  console.log(`HEVC actual browser decoding is ${hevcDecoded ? 'available and applied' : 'unavailable and rejected'}; audio-only rejection remains deterministic.`);

  const blockedPage = await browser.newPage();
  const blockedResult = blockedPage.waitForEvent('console', {predicate: message => message.text().startsWith('autoplay-result ')});
  await blockedPage.addInitScript(() => {
    const timer = setInterval(() => {
      const qa = window.qa;
      if (!qa?.ready) return;
      clearInterval(timer);
      qa.players[0].destroy();
      qa.players[0] = qa.createPlayer(document.getElementById('first'), {muted: false});
      qa.players[0].on('qualitychange', event => {
        if (event.detail.status !== 'applied') return;
        console.log('autoplay-result ' + JSON.stringify(event.detail.quality.outcome));
      });
      qa.players[0].load(qa.manifest(), {baseUrl: location.href}).then(() => qa.players[0].play());
    }, 20);
  });
  await blockedPage.goto(base + '/quality.html?blocked');
  const autoplayResult = JSON.parse((await blockedResult).text().slice('autoplay-result '.length));
  assert.deepEqual([autoplayResult.reason, autoplayResult.playing], ['autoplay-blocked', false]);
  assert.deepEqual(await blockedPage.evaluate(() => {
    const s = window.qa.players[0].state;
    return [s.phase, s.playing, s.quality.outcome.status, s.quality.outcome.playing];
  }), ['paused', false, 'applied', false]);
  const blockedNoop = await blockedPage.evaluate(async () => {
    const p = window.qa.players[0], host = document.querySelector('#first').firstElementChild.shadowRoot;
    const media = host.querySelector('video'), ack = await p.selectQuality(p.state.quality.active);
    return [ack.status, p.state.phase, host.querySelector('video') === media, p.state.quality.pending];
  });
  assert.deepEqual(blockedNoop, ['applied', 'paused', true, null]);
  console.log('F8 selecting autoplay-blocked healthy media is a no-op without a replacement element.');
  await blockedPage.close();
  console.log('7 restore-first transport failure, rejection, paused resolution/readiness timeouts, unsupported format, no decoded video and real autoplay rejection passed.');

  await page.evaluate(async () => {
    const qa = window.qa;
    qa.providerLabel = null;
    const adapter = {kind: 'fixture-provider', adaptive: true, pinned: true, supports: () => true,
      async attach(media, source) {
        media.src = source.url; media.load();
        return {confirmedRendition: source.rendition, rendition: () => qa.providerLabel && {label: qa.providerLabel}, detach() {}};
      }};
    qa.players[0].destroy();
    qa.players[0] = qa.createPlayer(document.getElementById('first'), {deliveries: [adapter]});
    const catalogue = {revision: 1, options: [{id: 'auto', label: 'Auto', mode: 'auto', delivery: {kind: 'fixture-provider'}}, {id: 'pinned', label: 'Pinned', delivery: {kind: 'fixture-provider'}}], default: 'auto', fallback: []};
    qa.providerCatalogue = catalogue;
    qa.providerResolver = request => ({status: 'source', source: {quality: request.quality, url: new URL('/quality/first', location.href).href,
      delivery: {kind: 'fixture-provider', rendition: request.quality === 'pinned' ? 'confirmed-choice' : undefined}}});
    await qa.players[0].load(qa.manifest(), {baseUrl: location.href, qualities: catalogue, resolveSource: qa.providerResolver});
  });
  await wait('auto');
  assert.equal((await state(0)).quality.rendition, 'unknown');
  await page.evaluate(() => {window.qa.providerLabel = 'Reported rendition';});
  await expect(first.locator('#quality-status')).toContainText('Reported rendition');
  assert.equal((await page.evaluate(() => window.qa.players[0].selectQuality('pinned'))).active, 'pinned');
  await page.evaluate(async () => {
    const qa = window.qa;
    await qa.players[1].load(qa.manifest(), {baseUrl: location.href, qualities: qa.providerCatalogue, resolveSource: qa.providerResolver});
  });
  await page.waitForFunction(() => window.qa.players[1].state.phase === 'error');
  assert.deepEqual((await state(1)).quality.options, []);
  assert.equal((await state(1)).quality.outcome.reason, 'unsupported');
  await expect(second.locator('#quality-control')).toBeHidden();
  console.log('9 app adapter protocol with real decoded media, Auto unknown/reported rendition, explicit pinned acknowledgement and absent capability passed.');

  await page.evaluate(async () => {
    const qa = window.qa;
    await qa.players[0].load(qa.manifest(), {baseUrl: location.href, qualities: qa.catalogue(1), resolveSource: request => new Promise(done => {qa.destroyedRequest = {request, done};})});
    qa.destroyedAck = qa.players[0].selectQuality('detail');
  });
  await page.waitForFunction(() => window.qa.destroyedRequest?.request.quality === 'detail');
  await page.evaluate(() => window.qa.players[0].destroy());
  assert.equal(await page.evaluate(async () => (await window.qa.destroyedAck).reason), 'destroy');
  await page.evaluate(async () => {const item = window.qa.destroyedRequest; item.done(await window.qa.blobSource(item.request)); window.qa.players[1].destroy();});
  await expect.poll(() => page.evaluate(() => window.qa.owned.size)).toBe(0);
  const publicEvents = await page.evaluate(() => JSON.stringify(window.qa.events));
  assert.equal(publicEvents.includes('signature='), false); assert.equal(publicEvents.includes('token=unsafe'), false);
  assert.equal(await page.locator('video').count(), 0);
  assert.deepEqual(errors, []);
  const lan = Object.values(networkInterfaces()).flat().find(value => value.family === 'IPv4' && !value.internal);
  if (lan) {
    const lanPage = await browser.newPage();
    await lanPage.goto(`http://${lan.address}:${server.address().port}/quality.html`);
    await lanPage.waitForFunction(() => window.qa?.ready && window.qa.players.every(p => p.state.quality.active === 'economy'));
    assert.equal(await lanPage.evaluate(() => isSecureContext), false);
    assert.equal(await lanPage.evaluate(() => new Set(window.qa.players.map(p => p.state.load)).size), 2);
    await lanPage.evaluate(() => window.qa.players.forEach(p => p.destroy()));
    await lanPage.close();
    console.log('HTTP LAN loading passed without a secure-context-only identity API.');
  }
  console.log('Quality browser verification passed all nine scenarios with generated media, actual source resources and lease cleanup.');
} finally {
  await browser?.close();
  if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
  demo?.closeAllConnections(); demo?.close();
  await rm(directory, {recursive: true, force: true});
}
