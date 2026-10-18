// Deterministic camera motion check against the built player and a local DEM.
import {chromium} from '@playwright/test';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createDemoServer} from '../tests/server.mjs';
import {verifyCameraTracking} from './camera-tracking.mjs';

const server = createDemoServer(); server.listen(0,'0.0.0.0'); await once(server,'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:900,height:760},deviceScaleFactor:.75});
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  const manifest = JSON.parse(await readFile(new URL('../demo/public/demo/manifest.json',import.meta.url)));
  manifest.map = {style:{version:8,sources:{dem:{type:'raster-dem',tiles:[base+'/fixtures/regression/terrain.png'],tileSize:256,maxzoom:0,encoding:'terrarium'}},layers:[{id:'background',type:'background',paint:{'background-color':'#15313c'}}]},terrain:{source:'dem',exaggeration:1}};
  await page.route('**/*',route => route.request().url().startsWith(base+'/') || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
  await page.route(base+'/demo/manifest.json',route => route.fulfill({json:manifest}));
  await page.goto(base);
  await page.waitForFunction(() => window.demo?.players[0].state?.mapReady && window.demo.players[0].state.phase === 'paused' && window.demo.players[0].state.mainView === 'video');
  await page.locator('#first #swap').click();
  await verifyCameraTracking(page,'map');
  await verifyCameraTracking(page,'hud');
  assert.deepEqual(errors,[]);
  assert.deepEqual(await page.evaluate(() => window.demo.resourceErrors),[]);
  await page.screenshot({path:join(tmpdir(),'gps-video-player-camera-tracking.png')});
  await page.evaluate(() => window.demo.players[0].destroy());
} finally {
  await browser?.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
