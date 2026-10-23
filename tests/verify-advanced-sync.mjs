import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDemoServer} from './server.mjs';

const server = createDemoServer();
server.listen(0, '0.0.0.0');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  await page.route('**/*', route => route.request().url().startsWith(base + '/') || route.request().url().startsWith('blob:')
    ? route.continue() : route.abort());
  await page.goto(base + '/integration.html');
  await page.waitForFunction(() => window.demo?.players.every(p => p.state?.mapReady && p.state.phase === 'paused'));
  await page.evaluate(() => {
    document.querySelector('#second').style.display = 'none';
    document.querySelector('#players').style.cssText = 'display:block;margin:0;padding:0';
  });
  const metrics = () => page.evaluate(() => {
    const root = document.querySelector('#first').firstElementChild.shadowRoot;
    const box = id => root.querySelector(id).getBoundingClientRect();
    const visible = id => root.getElementById(id).getClientRects().length > 0;
    return {dashboard: box('.dashboard').height, views: box('#views').height, row: visible('sync-controls'),
      buttons: ['minus', 'plus', 'reset'].map(visible), offset: visible('offset')};
  });
  const player = (method, value) => page.evaluate(([m, v]) => window.demo.players[0][m](v), [method, value]);
  const state = () => page.evaluate(() => window.demo.players[0].state);
  for (const width of [1100, 650]) {
    await page.evaluate(width => { document.querySelector('#first').style.cssText = `width:${width}px;height:660px`; }, width);
    await page.locator('#first .player').focus();
    const closed = await metrics();
    assert.deepEqual([closed.row, closed.buttons], [false, [false, false, false]], `${width}: closed hides row`);
    await page.keyboard.press('a');
    const open = await metrics();
    assert.deepEqual(open.buttons, [true, true, true], `${width}: A shows buttons`);
    assert.ok(open.dashboard - closed.dashboard >= 30 && closed.views - open.views >= 30, `${width}: closed row releases height`);
    await page.keyboard.press('a');
    assert.deepEqual((await metrics()).buttons, [false, false, false], `${width}: A hides buttons`);
    await page.keyboard.press(',');
    assert.equal((await state()).nudge, 0, `${width}: comma is inert while closed`);
    await player('setNudge', 0.4);
    const readout = await metrics();
    assert.deepEqual([readout.row, readout.offset, readout.buttons], [true, true, [false, false, false]], `${width}: offset without buttons`);
    assert.ok(readout.dashboard < open.dashboard && readout.dashboard > closed.dashboard, `${width}: readout height`);
    await page.keyboard.press('a');
    await page.keyboard.press('a');
    assert.equal((await state()).nudge, 0.4, `${width}: nudge survives close`);
    await player('setNudge', 0);
    assert.equal((await metrics()).dashboard, closed.dashboard, `${width}: zero nudge reclaims the row`);
  }
  console.log('Advanced sync passed at 1100px and 650px on the built player.');
} finally {
  await browser.close();
  server.close();
}
