import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createDemoServer} from './server.mjs';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const server=createDemoServer();server.listen(0,'0.0.0.0');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const cdn=createDemoServer();cdn.listen(0,'0.0.0.0');await once(cdn,'listening');
const cdnBase=`http://127.0.0.1:${cdn.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[], requests=[];
try {
  const page=await browser.newPage({viewport:{width:1500,height:1100}});
  page.setDefaultTimeout(20000);
  await page.addInitScript(()=>{
    const liveWorkers=new Set(), liveUrls=new Set();
    const OriginalWorker=window.Worker;
    window.Worker=class extends OriginalWorker {
      constructor(...args){super(...args);liveWorkers.add(this);}
      terminate(){liveWorkers.delete(this);return super.terminate();}
    };
    const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);liveUrls.add(url);return url;};
    URL.revokeObjectURL=url=>{liveUrls.delete(url);return revoke(url);};
    window.lifecycle={liveWorkers,liveUrls};
  });
  page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.stack);});
  page.on('console',m=>{if(m.type()==='error')console.error('Browser console:',m.text());});
  page.on('request',r=>requests.push(r.url()));
  const localRuntime=url=>url.startsWith(base+'/') || url.startsWith(cdnBase+'/') || url.startsWith('blob:');
  // Fail closed: deterministic smoke must never need a public provider.
  await page.route('**/*',route=>localRuntime(route.request().url()) ? route.continue() : route.abort());
  await page.route(base+'/dist/player.js', route=>route.fulfill({status:302,headers:{Location:cdnBase+'/dist/player.js','Access-Control-Allow-Origin':'*'},body:''}));
  await page.goto(base+'/integration.html');
  await page.waitForFunction(()=>window.demo?.players.every(p=>p.state?.mapReady && p.state.phase==='paused')).catch(async error=>{console.error(await page.evaluate(()=>({status:document.getElementById('status').textContent,states:window.demo?.players.map(p=>p.state),notices:[...document.querySelectorAll('.mount')].map(m=>m.firstElementChild?.shadowRoot?.getElementById('notice')?.textContent)})));throw error;});
  const first=page.locator('#first'), second=page.locator('#second');
  const state=()=>page.evaluate(()=>window.demo.players.map(p=>p.state));
  const expectHints=async mount=>{
    for(const [id,key] of Object.entries({play:'Space',mode:'M',swap:'S',follow:'C',heading:'H',mute:'U',fullscreen:'F',takeoff:'T',landing:'L',minus:',',plus:'.',reset:'R'})) {
      await expect(mount.locator(`#${id} kbd`)).toHaveText(key);
      await expect(mount.locator(`#${id} kbd`)).toBeVisible();
    }
  };
  await expectHints(first);
  await expectHints(second);
  await expect(first.locator('#fullscreen')).toHaveAttribute('aria-keyshortcuts','f Escape');
  await expect(first.locator('#fullscreen')).toHaveAttribute('title','Fullscreen (F / Escape)');
  for(const [key,id,changed,restored] of [
    ['c','follow','↟ Follow pilot C','Following C'],
    ['h','heading','Heading off H','Heading on H'],
    ['u','mute','♪ U','Muted U'],
  ]) {
    await first.locator('.player').focus();
    await page.keyboard.press(key);
    await expect(first.locator('#'+id)).toHaveText(changed);
    await page.keyboard.press(key);
    await expect(first.locator('#'+id)).toHaveText(restored);
  }
  await expect(second.locator('#follow')).toHaveText('Following C');
  await expect(second.locator('#heading')).toHaveText('Heading on H');
  await expect(second.locator('#mute')).toHaveText('Muted U');
  const bandPixels=mount=>mount.locator('#profile').evaluate(canvas=>[1,3,5,7,9,13].map(second=>{
    const pixel=canvas.getContext('2d').getImageData(Math.floor(canvas.width*second/20),canvas.height-3,1,1).data;
    return [...pixel];
  }));
  const band=[139,154,163,255], empty=[0,0,0,0];
  await expect.poll(()=>bandPixels(first)).toEqual([band,band,empty,band,band,empty]);
  assert.equal(await first.locator('#coverage-summary').count(),0);
  assert.equal(await first.locator('#coverage-legend').count(),0);
  assert.match(await first.locator('#profile').getAttribute('aria-valuetext'),/, video$/);
  await page.evaluate(()=>window.demo.players[0].setNudge(2));
  await expect.poll(()=>bandPixels(first)).toEqual([empty,band,band,empty,band,empty]);
  await expect.poll(()=>bandPixels(second)).toEqual([band,band,empty,band,band,empty]);
  await page.evaluate(()=>window.demo.players[0].setNudge(0));
  const profileBounds=await first.locator('#profile').boundingBox();
  await first.locator('#profile').click({position:{x:profileBounds.width/4,y:profileBounds.height-3}});
  assert.ok(Math.abs((await state())[0].elapsed-5)<.05,'The coverage band retains canvas seeking');
  await page.waitForFunction(()=>document.getElementById('first').firstElementChild.shadowRoot.getElementById('profile').getAttribute('aria-valuetext').endsWith(', no video'));
  await first.locator('#profile').click({position:{x:profileBounds.width/10,y:profileBounds.height-3}});
  assert.ok(Math.abs((await state())[0].elapsed-2)<.05,'Covered footage retains canvas seeking');
  await page.waitForFunction(()=>document.getElementById('first').firstElementChild.shadowRoot.getElementById('profile').getAttribute('aria-valuetext').endsWith(', video'));
  await page.evaluate(()=>window.demo.players[0].seek(0));
  await page.waitForFunction(()=>window.demo.players[0].state.phase==='paused');
  let states=await state();
  assert.equal(states[0].mediaTime,1);assert.equal(states[0].elapsed,0);
  assert.ok(await first.locator('#map canvas').count());
  assert.ok(requests.includes(cdnBase+'/dist/player.js'),'Built module loads from a separate CDN origin');
  assert.equal(requests.filter(url=>!url.startsWith(base) && !url.startsWith(cdnBase) && !url.startsWith('blob:'+base)).length,0,'No external runtime requests');
  assert.equal(requests.some(url=>url.includes('/src/')),false,'Tests use the actual built bundle');
  assert.equal(await page.evaluate(()=>document.querySelector('#first').shadowRoot),null,'Mount DOM is not replaced');
  await page.evaluate(()=>window.demo.players[0].setRate(2));
  assert.equal(await first.locator('#rate').inputValue(),'2','API rate updates its select');
  await page.evaluate(()=>window.demo.players[0].setRate(1.25));
  assert.equal(await first.locator('#rate').inputValue(),'1.25','Non-preset API rates remain visible');
  assert.equal(await first.locator('#rate option:checked').textContent(),'1.25×');
  await page.evaluate(()=>window.demo.players[0].setRate(0));
  assert.equal(await first.locator('#rate').inputValue(),'1.25','Invalid rates do not change the UI');
  await first.locator('#rate').selectOption('0.5');
  assert.equal((await state())[0].rate,.5);
  await page.evaluate(()=>window.demo.players[0].setRate(1));
  assert.equal(await first.locator('#rate [data-api-rate]').count(),0);
  const sizes=await page.evaluate(()=>['first','second'].map(id=>{const m=document.getElementById(id),r=m.firstElementChild.shadowRoot;return {mount:m.getBoundingClientRect().toJSON(),video:r.getElementById('video-panel').getBoundingClientRect().toJSON(),map:r.getElementById('map').getBoundingClientRect().toJSON()};}));
  for(const s of sizes){assert.ok(s.video.x>=s.mount.x && s.video.right<=s.mount.right);assert.ok(s.map.width>100 && s.map.width<s.mount.width);}
  await page.locator('h1').first().click();await page.keyboard.press('m');
  assert.equal((await state())[0].mode,'map','Page keyboard is not captured');
  await first.locator('.player').focus();await page.keyboard.press('m');
  assert.equal((await state())[0].mode,'hud');assert.equal((await state())[1].mode,'map');
  await expect(first.locator('#mode')).toHaveText('HUD M');
  assert.equal(await first.locator('#swap').isDisabled(),true);
  await page.keyboard.press('m');await page.keyboard.press('s');
  assert.equal((await state())[0].mainView,'map');
  await page.keyboard.press('s');
  await first.locator('#plus').click();
  assert.equal((await state())[0].nudge,.1);assert.equal((await state())[1].nudge,0);
  await expect.poll(()=>bandPixels(first)).toEqual([band,band,empty,band,band,empty]);
  await first.locator('#reset').click();
  await first.locator('#map canvas').focus();await page.keyboard.press('m');
  assert.equal((await state())[0].mode,'map','Map keyboard does not toggle player mode');
  await first.locator('#seek').focus();await page.keyboard.press('m');
  assert.equal((await state())[0].mode,'map','Native input keyboard is preserved');
  await first.locator('#profile').focus();await page.keyboard.press('ArrowRight');
  assert.equal((await state())[0].elapsed,5);
  await page.keyboard.press('Home');
  await page.waitForFunction(()=>window.demo.players[0].state.phase==='paused');
  const insetBefore=await first.locator('#inset-panel').boundingBox();
  await first.locator('#inset-handle').focus();await page.keyboard.press('ArrowLeft');
  const insetAfter=await first.locator('#inset-panel').boundingBox();
  assert.ok(Math.abs(insetAfter.x-insetBefore.x+10)<1);
  await page.setViewportSize({width:650,height:1100});
  // ResizeObserver clamps the inset on the next rendering cycle, not in the
  // viewport-change task. Wait for the geometry before asserting containment.
  await page.waitForFunction(()=>{
    const mount=document.getElementById('first'), bounds=mount.getBoundingClientRect();
    const inner=mount.firstElementChild.shadowRoot.getElementById('inset-panel').getBoundingClientRect();
    return inner.left>=bounds.left && inner.right<=bounds.right;
  });
  const bounds=await first.boundingBox(), inner=await first.locator('#inset-panel').boundingBox();
  assert.ok(inner.x>=bounds.x && inner.x+inner.width<=bounds.x+bounds.width);
  await page.setViewportSize({width:390,height:1100});
  await expectHints(first);
  assert.equal(await first.locator('.player').evaluate(shell=>{
    const bounds=shell.getBoundingClientRect();
    return [...shell.querySelectorAll('button kbd')].every(hint=>{
      const box=hint.getBoundingClientRect();
      return box.left>=bounds.left && box.right<=bounds.right && box.top>=bounds.top && box.bottom<=bounds.bottom;
    });
  }),true,'Button hints remain inside the narrow player');
  const labelFit=await first.locator('.profile-labels').evaluate(labels=>{
    const [start,end]=[...labels.children].map(el=>el.getBoundingClientRect());
    return {separate:start.right<=end.left,inside:start.left>=labels.getBoundingClientRect().left && end.right<=labels.getBoundingClientRect().right};
  });
  assert.deepEqual(labelFit,{separate:true,inside:true});
  assert.equal(await first.locator('#coverage-summary, #coverage-legend').count(),0);
  await expect.poll(()=>bandPixels(first)).toEqual([band,band,empty,band,band,empty]);
  await page.setViewportSize({width:1500,height:1100});
  await page.locator('h1').first().click();await page.keyboard.press('f');
  assert.equal(await page.evaluate(()=>document.fullscreenElement),null,'Page F does not enter fullscreen');
  await first.locator('#seek').focus();await page.keyboard.press('f');
  assert.equal(await page.evaluate(()=>document.fullscreenElement),null,'Native input F is preserved');
  await first.locator('.player').evaluate(shell=>{
    const input=document.createElement('div');input.id='editable-test';input.contentEditable='true';input.textContent='Edit';shell.append(input);input.focus();
  });
  await page.keyboard.press('f');
  assert.equal(await page.evaluate(()=>document.fullscreenElement),null,'Editable F is preserved');
  await first.locator('#editable-test').evaluate(input=>input.remove());
  await first.locator('.player').focus();await page.keyboard.press('x');
  assert.equal(await page.evaluate(()=>document.fullscreenElement),null,'X does not enter fullscreen');
  await page.keyboard.press('f');
  await page.waitForFunction(()=>document.fullscreenElement===document.getElementById('first').firstElementChild);
  await page.keyboard.press('x');
  assert.equal(await page.evaluate(()=>document.fullscreenElement===document.getElementById('first').firstElementChild),true,'X does not exit fullscreen');
  await page.keyboard.press('f');
  await page.waitForFunction(()=>!document.fullscreenElement);
  await second.locator('.player').focus();await page.keyboard.press('f');
  await page.waitForFunction(()=>document.fullscreenElement===document.getElementById('second').firstElementChild);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.fullscreenElement);
  await expectHints(first);
  await page.evaluate(()=>window.demo.players[0].seek(1.5));
  await page.waitForFunction(()=>window.demo.players[0].state?.phase==='paused' && Math.abs(window.demo.players[0].state.mediaTime-2.5)<.1);
  await page.evaluate(()=>window.demo.players[0].play());
  await page.waitForFunction(()=>window.demo.players[0].state.elapsed>1.8);
  await expect(first.locator('#play')).toHaveText('❚❚ Pause Space');
  states=await state();assert.equal(states[1].elapsed,0);assert.ok(Math.abs(states[0].utc-(states[0].origin+states[0].elapsed))<.01);
  assert.ok(Math.abs(states[0].sample.alt-(400+states[0].elapsed*3))<1);
  await page.evaluate(()=>window.demo.players[0].pause());
  await expect(first.locator('#play')).toHaveText('▶ Play Space');
  await page.evaluate(()=>window.demo.players[0].seek(3.7));
  await page.waitForFunction(()=>window.demo.players[0].state.phase==='paused');
  await page.evaluate(()=>window.demo.players[0].play());
  await page.waitForFunction(()=>window.demo.players[0].state.phase==='gap');
  assert.equal(await first.locator('video').count(),0,'Trim endpoint removes video before the file ends');
  await page.waitForFunction(()=>window.demo.players[0].state.clipIndex===1 && window.demo.players[0].state.elapsed>6.1);
  await page.evaluate(()=>window.demo.players[0].pause());
  states=await state();assert.ok(Math.abs(states[0].mediaTime-(states[0].elapsed-6+3))<.1);
  assert.match(await first.locator('#time-zone').textContent(),/2030-01-02/);
  // Real HTTP redirect: the nested track/media URLs must resolve after the redirect.
  await page.evaluate(()=>{
    window.demo.players[0].setRate(1.5);
    const volume=document.getElementById('first').firstElementChild.shadowRoot.getElementById('volume');
    volume.value='.25';volume.dispatchEvent(new Event('input'));
  });
  await page.evaluate(async base=>{await window.demo.players[0].load(base+'/redirect');},base);
  await page.waitForFunction(()=>window.demo.players[0].state?.mapReady && window.demo.players[0].state.phase==='paused');
  assert.equal(await first.locator('#rate').inputValue(),'1');
  assert.equal((await state())[0].rate,1);
  assert.equal(await first.locator('#rate [data-api-rate]').count(),0);
  assert.equal(await first.locator('#volume').inputValue(),'1');
  assert.equal(await first.locator('video').evaluate(video=>video.volume),1);
  assert.equal(await first.locator('video').evaluate(video=>video.playbackRate),1);
  await expect(first.locator('#mute')).toHaveText('Muted U');
  await expectHints(first);
  await page.evaluate(async base=>{
    const manifest=await (await fetch(base+'/fixtures/regression/manifest.json')).json();
    manifest.track.igc=await (await fetch(base+'/fixtures/regression/track.igc')).text();delete manifest.track.url;
    manifest.metadata.title='<img src=x onerror=alert(1)>';
    manifest.map.style.sources.dem={type:'raster-dem',tiles:['./terrain.png'],tileSize:256,maxzoom:0,encoding:'terrarium'};
    manifest.map.terrain={source:'dem',exaggeration:1};
    await window.demo.players[0].load(manifest,{baseUrl:base+'/fixtures/regression/manifest.json'});
  },base);
  await page.waitForFunction(()=>window.demo.players[0].state?.mapReady);
  assert.equal(await first.locator('h1 img').count(),0);
  assert.match(await first.locator('h1').textContent(),/^<img/);
  await page.waitForFunction(()=>window.demo.players[0].state?.phase==='paused');
  assert.equal(await first.locator('#map-status').textContent(),'');
  assert.deepEqual(await page.evaluate(()=>window.demo.resourceErrors),[]);
  // Empty/hidden mounts keep useful defaults. Pending and failed replacement loads clear stale flight UI.
  await page.evaluate(async()=>{
    const mount=document.createElement('div');mount.id='regression';
    mount.style.cssText='width:700px;height:660px;display:none';document.body.append(mount);
    window.regressionPlayer=window.demo.createPlayer(mount);await window.regressionPlayer.ready;
  });
  const regression=page.locator('#regression');
  assert.equal(await regression.locator('#video-status').textContent(),'No flight loaded');
  assert.equal(await regression.locator('#map-status').textContent(),'No flight loaded');
  assert.equal(await regression.locator('#inset-panel').evaluate(el=>el.style.width),'','Hidden mount must not acquire zero-width geometry');
  await page.evaluate(()=>document.getElementById('regression').style.display='block');
  await page.waitForFunction(()=>document.getElementById('regression').firstElementChild.shadowRoot.getElementById('inset-panel').offsetWidth>180);
  assert.ok((await regression.locator('#inset-panel').boundingBox()).height>=120);
  await page.evaluate(async base=>{await window.regressionPlayer.load(base+'/fixtures/regression/manifest.json');window.regressionPlayer.seek(2);},base);
  await page.waitForFunction(()=>window.regressionPlayer.state?.mapReady && window.regressionPlayer.state.phase==='paused' && document.getElementById('regression').firstElementChild.shadowRoot.getElementById('alt').textContent!=='—');
  await expect.poll(()=>bandPixels(regression)).toEqual([band,band,empty,band,band,empty]);
  await page.evaluate(async base=>{
    const manifest=await (await fetch(base+'/fixtures/regression/manifest.json')).json();
    manifest.clips=[];
    await window.regressionPlayer.load(manifest,{baseUrl:base+'/fixtures/regression/manifest.json'});
  },base);
  await page.waitForFunction(()=>window.regressionPlayer.state?.mapReady);
  await expect.poll(()=>bandPixels(regression)).toEqual([empty,empty,empty,empty,empty,empty]);
  assert.match(await regression.locator('#profile').getAttribute('aria-valuetext'),/, no video$/);
  await expect.poll(()=>bandPixels(first)).toEqual([band,band,empty,band,band,empty]);
  assert.notEqual(await regression.locator('#title').textContent(),'Flight player');
  assert.notEqual(await regression.locator('#start-label').textContent(),'');
  await page.evaluate(base=>{
    window.pendingRegression=window.regressionPlayer.load(base+'/pending',{fetch:()=>new Promise((_,reject)=>window.rejectRegression=reject)}).catch(e=>e.message);
  },base);
  assert.equal(await page.evaluate(()=>window.regressionPlayer.state),null);
  assert.equal(await regression.locator('#title').textContent(),'Flight player');
  assert.equal(await regression.locator('.player').getAttribute('aria-label'),'Flight video player');
  for(const id of ['local-time','alt','vario','speed']) assert.equal(await regression.locator('#'+id).textContent(),'—');
  assert.equal(await regression.locator('#time-zone').textContent(),'TIME');
  assert.equal(await regression.locator('#vario').evaluate(el=>el.style.color),'');
  for(const id of ['start-label','end-label']) assert.equal(await regression.locator('#'+id).textContent(),'');
  assert.equal(await regression.locator('#profile').getAttribute('aria-valuetext'),'No flight loaded');
  assert.equal(await regression.locator('#profile').evaluate(canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some(value=>value!==0)),false,'Pending load clears the profile pixels');
  assert.equal(await regression.locator('#map-status').textContent(),'Loading manifest…');
  assert.equal(await regression.locator('#video-status').textContent(),'Loading manifest…');
  await page.evaluate(async()=>{window.rejectRegression(new Error('Expected test failure'));await window.pendingRegression;});
  assert.equal(await regression.locator('#video-status').textContent(),'Player could not load');
  assert.equal(await regression.locator('#map-status').textContent(),'No flight loaded');
  assert.equal(await regression.locator('#title').textContent(),'Flight player');
  assert.equal(await regression.locator('#elapsed').textContent(),'— / —');
  await page.evaluate(()=>{window.regressionPlayer.destroy();document.getElementById('regression').remove();});
  const before=(await state())[0].elapsed;
  await page.evaluate(()=>{window.demo.players[1].destroy();window.demo.players[1].destroy();});
  assert.equal(await second.locator('video').count(),0);assert.equal(await second.locator('.player').count(),0);
  await page.evaluate(()=>window.demo.players[0].play());
  await page.waitForFunction(t=>window.demo.players[0].state.elapsed>t+.1,before);
  // Superseded loads and destroy cancel pending fetches without stale DOM writes.
  await page.evaluate(async base=>{
    const p=window.demo.players[0];
    const first=p.load(base+'/fixtures/regression/manifest.json').catch(e=>e.name);
    const last=p.load(base+'/fixtures/regression/manifest.json');
    await Promise.all([first,last]);
    p.destroy();
    const detached=document.createElement('div');document.body.append(detached);
    const pending=window.demo.createPlayer(detached,{manifest:base+'/fixtures/regression/manifest.json'});
    pending.destroy();await pending.ready.catch(()=>{});detached.remove();
    const mount=document.getElementById('first');
    const replacement=window.demo.createPlayer(mount,{manifest:base+'/fixtures/regression/manifest.json'});
    await replacement.ready;window.demo.replacement=replacement;
  },base);
  await page.waitForFunction(()=>window.demo.replacement.state?.mapReady && window.demo.replacement.state.phase==='paused');
  await page.screenshot({path:join(tmpdir(),'gps-video-player-player-smoke.png')});
  await page.evaluate(()=>window.demo.replacement.destroy());
  await page.waitForFunction(()=>window.lifecycle.liveWorkers.size===0 && window.lifecycle.liveUrls.size===0);
  assert.deepEqual(await page.evaluate(()=>({workers:window.lifecycle.liveWorkers.size,urls:window.lifecycle.liveUrls.size})),{workers:0,urls:0},'Destroy releases workers and Blob URLs');
  await page.evaluate(async ({base})=>{
    const {createPlayer}=window.demo;
    const outer=document.createElement('div');outer.id='nested';document.body.append(outer);
    const shadow=outer.attachShadow({mode:'open'}), mount=document.createElement('div');
    mount.style.height='660px';shadow.append(mount);
    const manifest=await (await fetch(base+'/fixtures/regression/manifest.json')).json();
    manifest.map.style.sources.dem={type:'raster-dem',tiles:['./terrain.png'],tileSize:256,maxzoom:0,encoding:'terrarium'};
    manifest.map.terrain={source:'dem',exaggeration:1};
    window.cdnPlayer=createPlayer(mount,{manifest,baseUrl:base+'/fixtures/regression/manifest.json'});
    window.cdnErrors=[];window.cdnPlayer.on('maperror',event=>window.cdnErrors.push(event.detail.message));
    await window.cdnPlayer.ready;
  },{base,cdnBase});
  await page.waitForFunction(()=>window.cdnPlayer.state?.mapReady && window.cdnPlayer.state.phase==='paused');
  await page.locator('#nested #fullscreen').click();
  await page.waitForFunction(()=>document.fullscreenElement===document.getElementById('nested'));
  await page.locator('#nested #fullscreen').click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  assert.deepEqual(await page.evaluate(()=>window.cdnErrors),[]);
  await page.evaluate(()=>{window.cdnPlayer.destroy();document.getElementById('nested').remove();});
  await page.waitForFunction(()=>window.lifecycle.liveWorkers.size===0 && window.lifecycle.liveUrls.size===0);
  assert.deepEqual(await page.evaluate(()=>window.demo.resourceErrors),[]);
  assert.deepEqual(errors,[]);
  // Exercise the default single-player page with its 90-second flight and video.
  // Replace only the online map configuration; provider rendering is a separate
  // optional live check, never a dependency of deterministic smoke.
  const mountain=JSON.parse(await readFile(new URL('../demo/public/demo/manifest.json',import.meta.url)));
  const offline=JSON.parse(await readFile(new URL('./fixtures/regression/manifest.json',import.meta.url)));
  mountain.map=offline.map;
  mountain.map.style.sources.dem={type:'raster-dem',tiles:[base+'/fixtures/regression/terrain.png'],tileSize:256,maxzoom:0,encoding:'terrarium',attribution:'Offline test terrain'};
  mountain.map.terrain={source:'dem',exaggeration:1};
  await page.route(base+'/demo/manifest.json',route=>route.fulfill({json:mountain}));
  await page.goto(base);
  await page.waitForFunction(()=>window.demo?.players.length===1 && window.demo.players[0].state?.mapReady && window.demo.players[0].state.phase==='paused' && window.demo.players[0].state.mainView==='video');
  assert.equal(await page.locator('[data-player]').count(),1);
  assert.equal(await page.locator('#second').count(),0);
  assert.equal(await page.locator('#module').inputValue(),'built');
  assert.equal(await page.locator('#manifest').inputValue(),'/demo/manifest.json');
  assert.equal(await page.locator('.summary').count(),0);
  assert.match(await page.locator('[data-seek="20"]').textContent(),/45-degree entry/);
  assert.match(await page.locator('[data-seek="60"]').textContent(),/40-degree right departure/);
  assert.match(await page.locator('#module-info').textContent(),/\/dist\/player.js/);
  const demoPlayer=page.locator('#first');
  assert.match(await demoPlayer.locator('.maplibregl-ctrl-attrib').textContent(),/Offline test terrain/);
  let longState=(await state())[0];
  assert.equal(longState.end,90);assert.equal(longState.elapsed,0);assert.equal(longState.mediaTime,0);
  assert.equal(await demoPlayer.locator('video').evaluate(v=>v.duration),90);
  assert.ok((await demoPlayer.boundingBox()).width>1300,'Main demo is one large player');
  assert.ok((await demoPlayer.locator('video').boundingBox()).width>1300,'Video is the main view');
  assert.equal(await demoPlayer.locator('#inset-panel #map').count(),1,'Terrain/live track is in picture-in-picture');
  await page.evaluate(()=>window.demo.players[0].seek(45));
  await page.waitForFunction(()=>window.demo.players[0].state.phase==='paused' && Math.abs(window.demo.players[0].state.mediaTime-45)<.1);
  for (const elapsed of [0,20,28,44,60]) {
    await page.locator(`[data-seek="${elapsed}"]`).click();
    await page.waitForFunction(t=>window.demo.players[0].state.elapsed===t && Math.abs(window.demo.players[0].state.mediaTime-t)<.1,elapsed);
  }
  await page.evaluate(()=>window.demo.players[0].seek(44));
  await page.waitForFunction(()=>window.demo.players[0].state?.elapsed===44 && window.demo.players[0].state.sample?.vario>1.5 && Math.abs(window.demo.players[0].state.mediaTime-44)<.1);
  assert.equal(await demoPlayer.locator('video').count(),1);
  await page.evaluate(()=>window.demo.players[0].play());
  await page.waitForFunction(()=>window.demo.players[0].state.elapsed>44.2);
  await page.evaluate(()=>window.demo.players[0].pause());
  await demoPlayer.locator('#profile').focus();await page.keyboard.press('End');
  await page.waitForFunction(()=>window.demo.players[0].state.elapsed===90);
  assert.equal(await demoPlayer.locator('video').count(),0,'Video trim and flight both end at 90 seconds');
  await page.evaluate(()=>window.demo.players[0].seek(600));
  assert.equal((await state())[0].elapsed,90,'No extra timeline extent');
  await page.keyboard.press('Home');
  await page.waitForFunction(()=>window.demo.players[0].state.phase==='paused' && window.demo.players[0].state.elapsed===0);
  await page.setViewportSize({width:650,height:1100});
  assert.ok((await demoPlayer.boundingBox()).width<=650);
  await page.setViewportSize({width:1500,height:1100});
  await page.screenshot({path:join(tmpdir(),'gps-video-player-single-player-smoke.png')});
  // Host form can replace a manifest, recover from failure, and expose its URL.
  await page.locator('#manifest').fill('/demo/missing.json');
  await page.locator('#load button[type=submit]').click();
  await page.waitForFunction(()=>window.demo.players[0].state===null);
  await page.locator('#manifest').fill('javascript:alert(1)');
  await page.locator('#load button[type=submit]').click();
  assert.match(await page.locator('#status').textContent(),/HTTP\(S\)/);
  assert.ok(!(await page.locator('#manifest-link').getAttribute('href')).startsWith('javascript:'),'Manifest links reject executable schemes');
  await page.locator('#manifest').fill('/fixtures/regression/manifest.json');
  await page.locator('#load button[type=submit]').click();
  await page.waitForFunction(()=>window.demo.players[0].state?.mapReady && window.demo.players[0].state.phase==='paused');
  assert.equal((await state())[0].end,20);
  assert.ok((await page.locator('#manifest-link').getAttribute('href')).endsWith('/fixtures/regression/manifest.json'));
  const supportedRate=await page.evaluate(()=>{
    const player=window.demo.players[0];
    for(const rate of [20,.01,Infinity,NaN]) player.setRate(rate);
    player.seek(1);
    return player.state.rate;
  });
  assert.equal(supportedRate,1,'Unsupported rates leave playback usable');
  await page.waitForFunction(()=>window.demo.players[0].state.phase==='paused');
  assert.equal(await demoPlayer.locator('video').evaluate(video=>video.playbackRate),1);
  await page.evaluate(()=>{
    window.requestAnimationFrame=()=>0;
    window.demo.players[0].seek(3.7);
    window.demo.players[0].play();
  });
  await page.waitForFunction(()=>window.demo.players[0].state.phase==='gap',null,{polling:50});
  assert.equal((await state())[0].elapsed,4,'Media events enforce trims without animation frames');
  assert.equal(await demoPlayer.locator('video').count(),0,'Trimmed media stops without animation frames');
  await page.evaluate(()=>window.demo.players[0].destroy());
  await page.waitForFunction(()=>window.lifecycle.liveWorkers.size===0 && window.lifecycle.liveUrls.size===0);
  assert.deepEqual(requests.filter(url=>!localRuntime(url)),[],'Entire smoke stays independent of the public network');
  assert.deepEqual(errors,[]);
  console.log('Single-player demo passed: 90-second synthetic track, 90-second pattern sync, chapter buttons, map-main layout, two 16-second thermal rotations, full-range profile seeking, responsive size, manifest selection and error recovery.');
  console.log('Browser smoke passed: built module, two maps, real WebM trim/play/gap/sync, UTC midnight, isolated controls/fullscreen, redirects, inline manifest, rate/audio resets, empty/hidden mounts, cleared pending/failed loads, load cancellation, destroy and recreation.');
} finally {
  await browser.close();
  for (const active of [server,cdn]) {active.closeAllConnections();await new Promise(resolve=>active.close(resolve));}
}
