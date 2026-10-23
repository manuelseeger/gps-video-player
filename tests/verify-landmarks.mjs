import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDemoServer} from './server.mjs';
import {landmarkTracks} from './landmark-fixtures.js';

const server = createDemoServer();
let browser;
try {
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(base + '/') || route.request().url().startsWith('blob:')
    ? route.continue() : route.abort());
  await page.route(base + '/landmarks.html', route => route.fulfill({contentType: 'text/html',
    body: '<div id="mount" style="height:660px"></div><script type="module">import {createPlayer} from "/dist/player.js";window.createPlayer=createPlayer;</script>'}));
  await page.goto(base + '/landmarks.html');
  await page.waitForFunction(() => window.createPlayer);
  const results = await page.evaluate(async tracks => {
    const player = window.createPlayer(document.getElementById('mount'));
    window.player = player;
    const output = [];
    output.push([player.landmark('takeoff'), player.seekLandmark('landing'), player.state]);
    const load = async (igc, video = false) => {
      await player.load({version: 1, track: {igc, startUtc: '2030-01-01T12:00:00Z'},
        clips: video ? [{url: '/fixtures/regression/demo.webm', startUtc: '2030-01-01T11:59:55Z', durationSeconds: 40}] : [],
        map: {style: {version: 8, sources: {}, layers: []}}}, {baseUrl: location.href});
    };
    await load(tracks.both, true);
    player.seek(2);
    output.push([player.state.start, player.state.end, player.landmark('takeoff'), player.state.elapsed]);
    output.push([player.seekLandmark('takeoff'), player.state.elapsed]);
    player.setNudge(2.5);
    output.push([player.landmark('landing'), player.seekLandmark('landing'), player.state.elapsed]);
    await load(tracks.both);
    player.setNudge(-1.5);
    output.push([player.landmark('takeoff'), player.seekLandmark('landing'), player.state.elapsed]);
    const root = document.getElementById('mount').firstElementChild.shadowRoot;
    output.push([root.getElementById('takeoff').title, root.getElementById('landing').title]);
    root.getElementById('takeoff').click();
    output.push(player.state.elapsed);
    root.getElementById('landing').click();
    output.push(player.state.elapsed);
    const shell = root.querySelector('.player');
    shell.dispatchEvent(new KeyboardEvent('keydown', {key: 't', bubbles: true}));
    output.push(player.state.elapsed);
    shell.dispatchEvent(new KeyboardEvent('keydown', {key: 'l', bubbles: true}));
    output.push(player.state.elapsed);
    for (const name of ['ground', 'startsAirborne', 'endsAirborne']) {
      await load(tracks[name]);
      player.seek(2);
      output.push([name, player.landmark('takeoff'), player.landmark('landing')]);
      const missing = name === 'endsAirborne' ? 'landing' : 'takeoff';
      output.push([player.seekLandmark(missing), player.state.elapsed, player.state.playing]);
    }
    await player.load({version: 1, track: {igc: 'invalid', startUtc: '2030-01-01T12:00:00Z'}, clips: []},
      {baseUrl: location.href}).catch(() => {});
    output.push([player.landmark('landing'), player.seekLandmark('takeoff'), player.state]);
    player.destroy();
    output.push(['landmark', 'seekLandmark'].map(method => {
      try { player[method]('takeoff'); } catch (error) { return error.message; }
    }));
    return output;
  }, landmarkTracks);
  const available = (landmark, elapsed) => ({status: 'available', landmark, elapsed});
  const applied = (landmark, elapsed) => ({status: 'applied', landmark, elapsed});
  const unavailable = landmark => ({status: 'unavailable', landmark});
  assert.deepEqual(results, [
    [{status: 'no-flight'}, {status: 'no-flight'}, null],
    [0, 40, available('takeoff', 13), 2],
    [applied('takeoff', 13), 13],
    [available('landing', 24.5), applied('landing', 24.5), 24.5],
    [available('takeoff', 9.5), applied('landing', 23.5), 23.5],
    ['Seek to track start', 'Seek to track end'],
    1.5, 31.5, 1.5, 31.5,
    ['ground', unavailable('takeoff'), unavailable('landing')],
    [unavailable('takeoff'), 2, false],
    ['startsAirborne', unavailable('takeoff'), available('landing', 13)],
    [unavailable('takeoff'), 2, false],
    ['endsAirborne', available('takeoff', 8), unavailable('landing')],
    [unavailable('landing'), 2, false],
    [{status: 'no-flight'}, {status: 'no-flight'}, null],
    ['Player is destroyed', 'Player is destroyed'],
  ]);
  assert.deepEqual(errors, []);
  console.log('Built player seekLandmark("takeoff") => {status:"applied",landmark:"takeoff",elapsed:13}; playback elapsed=13');
  console.log('Landmark browser checks passed: video bounds, track-only, both transitions, incomplete tracks, nudge, endpoint controls, no flight, failed load, destroyed player.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
