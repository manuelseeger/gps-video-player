// Optional public-network rendering check. Not part of deterministic smoke/CI.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDemoServer} from '../demo/server.mjs';
import {verifyCameraTracking} from './camera-tracking.mjs';
const server=createDemoServer();server.listen(0,'0.0.0.0');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const screenshots=['gps-video-player-live-departure.png','gps-video-player-live-thermal.png'].map(name=>join(tmpdir(),name));
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:.5});
  page.setDefaultTimeout(45000);
  const errors=[],responses=[],failures=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('requestfailed',request=>failures.push({url:request.url(),error:request.failure()?.errorText}));
  page.on('response',response=>{
    if(response.url().includes('arcgisonline.com/') || response.url().includes('elevation-tiles-prod/'))responses.push({url:response.url(),status:response.status(),type:response.headers()['content-type']});
  });
  await page.goto(base);
  await page.waitForFunction(()=>window.demo?.players[0].state?.mapReady && window.demo.players[0].state.phase==='paused' && window.demo.players[0].state.mainView==='video');
  await page.locator('#first #swap').click();
  await page.waitForLoadState('networkidle');
  const player=page.locator('#first');
  assert.equal(await player.locator('#map-status').textContent(),'');
  assert.match(await player.locator('.maplibregl-ctrl-attrib').textContent(),/Esri/);
  assert.match(await player.locator('.maplibregl-ctrl-attrib').textContent(),/Copernicus/);
  assert.equal(await player.locator('video').evaluate(v=>v.duration),90);
  await page.screenshot({path:screenshots[0],fullPage:true});
  await page.evaluate(()=>window.demo.players[0].seek(44));
  await page.waitForFunction(()=>window.demo.players[0].state.elapsed===44 && window.demo.players[0].state.sample?.vario>1.5);
  await page.waitForLoadState('networkidle');
  assert.equal(await player.locator('video').count(),1);
  await page.waitForFunction(()=>Math.abs(window.demo.players[0].state.mediaTime-44)<.1);
  await page.screenshot({path:screenshots[1],fullPage:true});
  await page.setViewportSize({width:640,height:640});
  const camera = await verifyCameraTracking(page,'map');
  assert.deepEqual(errors,[]);
  assert.deepEqual(await page.evaluate(()=>window.demo.resourceErrors),[]);
  // Camera changes cancel tiles that are no longer in view. Those are not
  // provider failures; all completed provider responses must still be images.
  assert.deepEqual(failures.filter(f=>f.error!=='net::ERR_ABORTED'),[]);
  const imagery=responses.filter(r=>r.url.includes('arcgisonline.com/'));
  const dem=responses.filter(r=>r.url.includes('elevation-tiles-prod/'));
  assert.ok(imagery.length>2 && imagery.every(r=>r.status===200 && r.type?.startsWith('image/')),'Satellite tiles load in Chromium');
  assert.ok(dem.length>2 && dem.every(r=>r.status===200 && r.type==='image/png'),'Real DEM tiles load in Chromium');
  console.log(JSON.stringify({imageryTiles:imagery.length,demTiles:dem.length,terrain:'Terrarium, exaggeration 1',camera,sample:await page.evaluate(()=>window.demo.players[0].state.sample),screenshots,errors,failures:failures.filter(f=>f.error!=='net::ERR_ABORTED'),cancelledTileRequests:failures.filter(f=>f.error==='net::ERR_ABORTED').length},null,2));
  await page.evaluate(()=>window.demo.players[0].destroy());
} finally {
  await browser?.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
