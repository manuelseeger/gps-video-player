import {chromium, expect} from '@playwright/test';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createDemoServer} from '../tests/server.mjs';

const server = createDemoServer();
server.listen(0, '0.0.0.0');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined, args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:1100,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const defineProperty = Object.defineProperty;
    Object.defineProperty = function(target, key, descriptor) {
      if (key === 'transform' && target._camera && typeof target.getCenter === 'function') window.testMap = target;
      return defineProperty(target, key, descriptor);
    };
  });
  const manifest = JSON.parse(await readFile(new URL('../demo/public/demo/manifest.json', import.meta.url)));
  manifest.map = {style:{version:8,sources:{dem:{type:'raster-dem',tiles:[base+'/fixtures/regression/terrain.png'],tileSize:256,maxzoom:0,encoding:'terrarium'}},layers:[{id:'background',type:'background',paint:{'background-color':'#15313c'}}]},terrain:{source:'dem',exaggeration:1}};
  await page.route('**/*', route => route.request().url().startsWith(base+'/') || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
  await page.route(base+'/demo/manifest.json', route => route.fulfill({json:manifest}));
  await page.goto(base);
  await page.waitForFunction(() => window.demo?.players[0].state?.mapReady && window.demo.players[0].state.phase === 'paused');
  await page.locator('#first #swap').click();
  const follow = page.locator('#first #follow');
  const canvas = page.locator('#first #map canvas');
  const center = () => page.evaluate(() => window.testMap.getCenter().toArray());
  assert.equal(await canvas.evaluate(element => element === window.testMap?.getCanvas()), true, 'Captured camera belongs to the tested canvas');
  const box = await canvas.boundingBox();
  const x = box.x + box.width * .35, y = box.y + box.height * .4;
  for (const hold of [100, 0]) {
    if (!(await follow.getAttribute('class')).split(' ').includes('active')) await follow.click();
    await expect(follow).toHaveText('Following C');
    const before = await center();
    await page.mouse.move(x, y);
    await page.mouse.down();
    if (hold) await page.waitForTimeout(hold);
    await page.mouse.move(x + 150, y + 50, {steps:12});
    await page.mouse.up();
    await expect(follow).toHaveText('↟ Follow pilot C');
    await expect.poll(async () => Math.hypot(...(await center()).map((value, i) => value - before[i]))).toBeGreaterThan(.00001);
    console.log(`PASS: ${hold} ms hold then drag changes map center and disables following.`);
  }
  await follow.click();
  await expect(follow).toHaveText('Following C');
  const beforeClick = await center();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.evaluate(() => window.demo.players[0].seek(40));
  await page.waitForFunction(() => window.demo.players[0].state.elapsed === 40 && window.demo.players[0].state.phase === 'paused');
  assert.deepEqual(await center(), beforeClick, 'Camera stays still during a pointer hold');
  await expect(page.locator('#first #profile')).toHaveAttribute('aria-valuenow', '44');
  await page.mouse.up();
  await expect(follow).toHaveText('Following C');
  await expect.poll(async () => Math.hypot(...(await center()).map((value, i) => value - beforeClick[i]))).toBeGreaterThan(.00001);
  const sample = await page.evaluate(() => window.demo.players[0].state.sample);
  await expect.poll(async () => Math.hypot(...(await center()).map((value, i) => value - [sample.lon, sample.lat][i]))).toBeLessThan(1e-9);
  console.log('PASS: click without drag keeps following on; telemetry updates during the hold and the camera resumes after pointerup.');
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.demo.resourceErrors), []);
  await page.evaluate(() => window.demo.players[0].destroy());
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
