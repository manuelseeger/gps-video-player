import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDemoServer} from './server.mjs';

const screenshots = await mkdtemp(join(tmpdir(), 'gps-compact-fullscreen-'));
const server = createDemoServer();
let browser;
try {
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width:1280, height:900}});
  const cdp = await page.context().newCDPSession(page);
  let viewport = {width:1280,height:900};
  const resize = async size => {
    viewport = size;
    await cdp.send('Emulation.setDeviceMetricsOverride', {...size, screenWidth:size.width, screenHeight:size.height,
      deviceScaleFactor:1, mobile:false, screenOrientation:{type:size.width > size.height ? 'landscapePrimary' : 'portraitPrimary', angle:size.width > size.height ? 90 : 0}});
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(base + '/') || route.request().url().startsWith('blob:')
    ? route.continue() : route.abort());
  await page.goto(base + '/integration.html');
  await page.waitForFunction(() => window.demo?.players.every(p => p.state?.mapReady && p.state.phase === 'paused'));
  await page.evaluate(async () => {
    const manifest = await (await fetch('/fixtures/regression/manifest.json')).json();
    manifest.version = 2;
    manifest.map.style.sources.attribution = {type:'geojson', attribution:'Synthetic map attribution',
      data:{type:'FeatureCollection',features:[]}};
    manifest.map.style.layers.push({id:'attribution',type:'circle',source:'attribution'});
    manifest.qualities = {options:[{id:'economy', label:'Data saver'}, {id:'detail', label:'Fine view'}], default:'economy', fallback:[]};
    manifest.clips = manifest.clips.map(({url, mediaOffsetSeconds, ...clip}) => ({...clip, sources:{
      economy:{url, mediaStartSeconds:mediaOffsetSeconds}, detail:{url:url + '?detail', mediaStartSeconds:mediaOffsetSeconds},
    }}));
    window.compactManifest = manifest;
    await window.demo.players[0].load(manifest, {baseUrl:new URL('/fixtures/regression/manifest.json', location.href).href});
    document.querySelector('#second').style.display = 'none';
    document.querySelector('body > header').style.display = 'none';
    document.querySelector('body > footer').style.display = 'none';
    document.querySelector('#players').style.cssText = 'display:block;margin:0;padding:0';
    document.querySelector('#first').style.cssText = 'width:1100px;height:660px';
    window.controlNodes = [...document.querySelector('#first').firstElementChild.shadowRoot.querySelectorAll('[id]')];
    window.secondNodes = [...document.querySelector('#second').firstElementChild.shadowRoot.querySelectorAll('[id]')];
  });
  const first = page.locator('#first');
  const state = () => page.evaluate(() => window.demo.players[0].state);
  const api = (method, value) => page.evaluate(([m,v]) => window.demo.players[0][m](v), [method,value]);
  const identity = async () => assert.equal(await page.evaluate(() => [window.controlNodes,window.secondNodes].every((nodes,i) => {
    const root = document.querySelector(i ? '#second' : '#first').firstElementChild.shadowRoot;
    return nodes.every(node => root.getElementById(node.id) === node && root.querySelectorAll(`[id="${node.id}"]`).length === 1);
  })), true, 'original nodes and IDs survive transitions and remain instance-local');
  const fullscreen = async on => {
    await first.locator('#fullscreen').click();
    await page.waitForFunction(on => {
      const host = document.querySelector('#first').firstElementChild;
      return on ? document.fullscreenElement === host : !document.fullscreenElement;
    }, on);
    await expect(first.locator('.player')).toHaveClass(on && (viewport.width <= 700 || viewport.height <= 500)
      ? /compact/ : /^(?!.*\bcompact\b)/);
    await expect(first.locator('#fullscreen')).toHaveAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
    if (on && (viewport.width <= 700 || viewport.height <= 500)) {
      await expect(first.locator('#fullscreen')).toHaveText('Exit F');
    }
  };
  const select = async detail => {
    const trigger = detail === 'sync' ? 'advanced' : `compact-${detail}-toggle`;
    await first.locator(`#${trigger}`).click();
    await expect(first.locator(`#compact-${detail}`)).toBeVisible();
    for (const other of ['profile','options','sync'].filter(value => value !== detail)) {
      await expect(first.locator(`#compact-${other}`)).toBeHidden();
    }
    assert.equal((await state()).advancedSync, detail === 'sync');
  };
  const close = async () => {
    await first.locator('#compact-close').click();
    await expect(first.locator('#compact-details')).toBeHidden();
  };
  const geometry = async () => {
    let result;
    await expect.poll(async () => {
      result = await first.locator('.player').evaluate(shell => {
        const root = shell.getRootNode();
        const box = element => element.getBoundingClientRect();
        const inside = r => r.width > 0 && r.height > 0 && r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
        const ids = ['alt','vario','speed','play','seek','elapsed','advanced','fullscreen','compact-profile-toggle','compact-options-toggle'];
        const essential = ids.map(id => root.getElementById(id));
        const actions = essential.filter(node => node.matches('button,input'));
        const rects = essential.map(box);
        const overlap = rects.some((a,i) => rects.slice(i+1).some(b => Math.min(a.right,b.right)-Math.max(a.left,b.left) > 1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top) > 1));
        const details = box(root.getElementById('compact-details'));
        const controls = box(root.getElementById('compact-controls'));
        return {contained:rects.every(inside), targets:actions.every(node => box(node).width >= 44 && box(node).height >= 44),
          overlap, overflow:[shell,...['compact-details','compact-profile','compact-options','compact-sync'].map(id => root.getElementById(id))]
            .some(node => node.getClientRects().length && node.scrollWidth > node.clientWidth),
          detailClear:!details.height || details.bottom <= controls.top + 0.5,
          detailContext:!details.height || details.top >= 30,
          height:controls.height, views:box(root.getElementById('views')).height};
      });
      return result.contained && result.targets && !result.overlap && !result.overflow && result.detailClear && result.detailContext;
    }).toBe(true);
    assert.equal(result.contained, true, JSON.stringify(result));
    assert.equal(result.targets, true, JSON.stringify(result));
    assert.equal(result.overlap, false, JSON.stringify(result));
    assert.equal(result.overflow, false, JSON.stringify(result));
    assert.equal(result.detailClear, true, JSON.stringify(result));
    assert.equal(result.detailContext, true, JSON.stringify(result));
    assert.ok(result.height < 200, JSON.stringify(result));
    assert.ok(result.views > viewport.height - 200, JSON.stringify(result));
    return result;
  };
  const mapGeometry = async () => {
    await expect.poll(() => first.locator('#map').evaluate(element => {
      const canvas = element.querySelector('canvas');
      return !!canvas && Math.abs(canvas.clientWidth-element.clientWidth) <= 1 && Math.abs(canvas.clientHeight-element.clientHeight) <= 1;
    })).toBe(true);
    if ((await state()).mode !== 'hud') {
      await expect.poll(() => first.locator('#inset-panel').evaluate(inset => {
        const views = inset.getRootNode().getElementById('views').getBoundingClientRect(), r = inset.getBoundingClientRect();
        return r.left >= views.left-1 && r.top >= views.top-1 && r.right <= views.right+1 && r.bottom <= views.bottom+1;
      })).toBe(true);
    }
  };
  const mapControls = async () => {
    const measured = await first.locator('#map').evaluate(map => {
      const root = map.getRootNode(), bounds = map.getBoundingClientRect();
      return [...map.querySelectorAll('.maplibregl-ctrl-group button, summary.maplibregl-ctrl-attrib-button')].map(node => {
        const r = node.getBoundingClientRect();
        const points = [[8,8],[r.width-8,8],[8,r.height-8],[r.width-8,r.height-8],[r.width/2,r.height/2]];
        return {control:node.className,width:r.width,height:r.height,top:r.top,bottom:r.bottom,mapHeight:bounds.height,
          contained:r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom,
          reachable:points.every(([x,y]) => node.contains(root.elementFromPoint(r.left+x,r.top+y)))};
      });
    });
    console.log(`${viewport.width}x${viewport.height} map controls ${JSON.stringify(measured)}`);
    assert.equal(measured.length,4,'three navigation targets and actual attribution summary');
    assert.ok(measured.every(r => r.width >= 44 && r.height >= 44 && r.contained && r.reachable),JSON.stringify(measured));
    const attribution = first.locator('summary.maplibregl-ctrl-attrib-button');
    await attribution.click();
    await expect(first.locator('.maplibregl-ctrl-attrib-inner')).toBeVisible();
    await expect(first.locator('.maplibregl-ctrl-attrib-inner')).toContainText('Synthetic map attribution');
    await attribution.click();
    await expect(first.locator('.maplibregl-ctrl-attrib-inner')).toBeHidden();
  };
  const shot = async name => {
    const {data} = await cdp.send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
    await writeFile(join(screenshots,name + '.png'),Buffer.from(data,'base64'));
  };
  for (const width of [650,1100]) {
    await page.evaluate(width => document.querySelector('#first').style.width = width + 'px', width);
    await expect(first.locator('#profile')).toBeVisible();
    await expect(first.locator('#compact-controls')).toBeHidden();
    assert.equal(await first.locator('.dashboard').evaluate(node => node.getBoundingClientRect().height), 200);
    await identity();
  }
  await fullscreen(true);
  await expect(first.locator('#profile')).toBeVisible();
  await shot('desktop-fullscreen');
  await fullscreen(false);
  for (const [width,height] of [[667,320],[390,844],[844,390],[320,568],[568,320]]) {
    await resize({width,height});
    await fullscreen(true);
    await expect(first.locator('#profile')).toBeHidden();
    const measured = await geometry();
    console.log(`${width}x${height}: controls ${measured.height}px, views ${measured.views}px`);
    await identity();
    await mapGeometry();
    await shot(`${width}x${height}-closed`);
    await first.locator('#play').click();
    await expect.poll(async () => (await state()).phase).toBe('playing');
    await expect.poll(async () => (await state()).elapsed).toBeGreaterThan(0.1);
    await first.locator('#play').click();
    await expect.poll(async () => (await state()).phase).toBe('paused');
    const paused = (await state()).elapsed;
    assert.equal(await first.locator('video').evaluate(video => video.paused),true);
    await first.locator('#seek').focus();
    await page.keyboard.press('End');
    await expect.poll(async () => (await state()).elapsed).toBe(20);
    await expect(first.locator('#elapsed')).toContainText('0:20');
    await page.keyboard.press('Home');
    await expect.poll(async () => (await state()).elapsed).toBe(0);
    assert.ok(paused > 0,'Play advances time before Pause');
    await expect.poll(async () => (await state()).phase).toBe('paused');
    console.log(`${width}x${height}: Play advanced to ${paused.toFixed(3)}s, Pause stopped media, timeline End=20s and Home=0s`);
    await select('options');
    await first.locator('#swap').click();
    await close();
    await api('setNudge',0.1);
    await mapGeometry();
    await shot(`${width}x${height}-map-main-offset`);
    await mapControls();
    await select('options');
    await first.locator('#swap').click();
    await close();
    await mapGeometry();
    await shot(`${width}x${height}-map-inset-offset`);
    await mapControls();
    await api('setNudge',0);
    for (const detail of ['profile','options','sync']) {
      await select(detail);
      await geometry();
      const closeBox = await first.locator('#compact-close').boundingBox();
      assert.ok(closeBox.width >= 44 && closeBox.height >= 44 && closeBox.y >= 0);
      if (detail === 'options') {
        await first.locator('#opacity').scrollIntoViewIfNeeded();
        await expect(first.locator('#opacity')).toBeInViewport();
        await geometry();
        assert.equal(await first.locator('#compact-options').evaluate(node => [...node.querySelectorAll('button,select,input')]
          .filter(node => node.getClientRects().length && !node.hidden).every(node => {
            const r = node.getBoundingClientRect(); return r.width >= 44 && r.height >= 44;
          })), true, 'Options touch targets');
      }
      await shot(`${width}x${height}-${detail}`);
    }
    await first.locator('#plus').click();
    assert.equal((await state()).nudge,0.1);
    await first.locator('#plus').click({modifiers:['Shift']});
    assert.equal((await state()).nudge,1.1);
    await first.locator('#reset').click();
    assert.equal((await state()).nudge,0);
    await api('setNudge',0.4);
    await close();
    await geometry();
    await shot(`${width}x${height}-offset`);
    await expect(first.locator('#offset')).toBeVisible();
    await expect(first.locator('#offset')).toBeInViewport();
    await expect(first.locator('#offset')).toHaveText('+0.4 s');
    for (const id of ['minus','plus','reset']) {
      await expect(first.locator(`#${id}`)).toBeHidden();
      await expect(first.locator(`#${id}`)).toBeDisabled();
    }
    await first.locator('.player').focus();
    await page.keyboard.press(',');
    assert.equal((await state()).nudge,0.4);
    await api('setNudge',0);
    await expect(first.locator('#offset')).toBeHidden();
    for (const detail of ['options','profile']) {
      await select(detail);
      await api('setAdvancedSync',false);
      await expect(first.locator(`#compact-${detail}`)).toBeVisible();
      await api('setAdvancedSync',true);
      await expect(first.locator('#compact-sync')).toBeVisible();
      await api('setAdvancedSync',false);
      await expect(first.locator('#compact-details')).toBeHidden();
    }
    await select('profile');
    await first.locator('#profile').click({position:{x:80,y:20}});
    await expect.poll(async () => (await state()).elapsed).toBeGreaterThan(0);
    await first.locator('#profile').focus();
    await page.keyboard.press('End');
    await expect.poll(async () => (await state()).elapsed).toBe(20);
    await page.keyboard.press('Home');
    await expect.poll(async () => (await state()).elapsed).toBe(0);
    await close();
    await expect(first.locator('#compact-profile-toggle')).toBeFocused();
    for (const [key,id,detail] of [['p','profile','profile'],['q','quality','options'],['b','rate','options'],['v','volume','options'],['o','opacity','options']]) {
      await first.locator('.player').focus();
      await page.keyboard.press(key);
      await expect(first.locator(`#${id}`)).toBeFocused();
      await expect(first.locator(`#compact-${detail}`)).toBeVisible();
      await close();
    }
    await first.locator('.player').focus();
    await page.keyboard.press('Control+p');
    await expect(first.locator('#compact-details')).toBeHidden();
    await select('options');
    await first.locator('#volume').focus();
    await page.keyboard.press('p');
    await expect(first.locator('#compact-options')).toBeVisible();
    await close();
    await select('profile');
    await first.locator('#profile').dispatchEvent('keydown',{key:'Escape',bubbles:true});
    await expect(first.locator('#compact-details')).toBeHidden();
    assert.equal(await page.evaluate(() => !!document.fullscreenElement),true);
    for (const detail of ['profile','options','sync']) {
      await select(detail);
      await fullscreen(false);
      await identity();
      await expect(first.locator('#profile')).toBeVisible();
      await api('setAdvancedSync',false);
      await fullscreen(true);
    }
    await fullscreen(false);
  }
  await resize({width:390,height:844});
  await fullscreen(true);
  await select('options');
  await first.locator('#rate').selectOption('2');
  await first.locator('#volume').fill('0.35');
  await first.locator('#mute').click();
  await first.locator('#quality').selectOption('detail');
  await expect.poll(async () => (await state()).quality.active).toBe('detail');
  await first.locator('#follow').click();
  await first.locator('#heading').click();
  await first.locator('#opacity').fill('0.55');
  await first.locator('#mode').click();
  const settings = () => first.locator('.player').evaluate(shell => {
    const root = shell.getRootNode(), value = id => root.getElementById(id).value;
    return {rate:value('rate'),volume:value('volume'),quality:value('quality'),opacity:value('opacity'),
      following:root.getElementById('follow').classList.contains('active'), heading:root.getElementById('heading').classList.contains('active'),
      muted:root.querySelector('video').muted,mediaVolume:root.querySelector('video').volume,
      mediaRate:root.querySelector('video').playbackRate,apiRate:window.demo.players[0].state.rate,mode:window.demo.players[0].state.mode};
  });
  const saved = await settings();
  assert.deepEqual(saved,{rate:'2',volume:'0.35',quality:'detail',opacity:'0.55',following:false,heading:false,muted:true,mediaVolume:0.35,mediaRate:2,apiRate:2,mode:'hud'});
  await close();
  await select('options');
  assert.deepEqual(await settings(),saved);
  await resize({width:844,height:390});
  await expect(first.locator('#compact-options')).toBeVisible();
  await geometry();
  await mapGeometry();
  await resize({width:1280,height:900});
  await expect(first.locator('#compact-controls')).toBeHidden();
  assert.deepEqual(await settings(),saved);
  await first.locator('#rate').focus();
  await resize({width:667,height:320});
  await expect(first.locator('#compact-details')).toBeHidden();
  await expect(first.locator('#compact-options-toggle')).toBeFocused();
  assert.deepEqual(await settings(),saved);
  await identity();
  await select('options');
  await first.locator('#mode').click();
  await first.locator('#swap').click();
  await mapGeometry();
  for (const size of [{width:390,height:844},{width:844,height:390},{width:667,height:320}]) {
    await resize(size);
    await geometry();
    await mapGeometry();
    await expect(first.locator('#compact-options')).toBeVisible();
  }
  await close();
  await first.locator('.player').focus();
  await page.keyboard.press('o');
  await expect(first.locator('#compact-details')).toBeHidden();
  await first.locator('.player').focus();
  await page.keyboard.press('s');
  await mapGeometry();
  await first.locator('.player').focus();
  await page.keyboard.press('q');
  await expect(first.locator('#quality')).toBeFocused();
  await resize({width:390,height:844});
  await expect(first.locator('#quality')).toBeFocused();
  await page.evaluate(() => document.exitFullscreen());
  await expect(first.locator('#compact-controls')).toBeHidden();
  await expect(first.locator('#quality')).toBeFocused();
  await identity();
  await page.evaluate(() => {document.querySelector('#first').firstElementChild.requestFullscreen = undefined;});
  await first.locator('#fullscreen').click();
  assert.equal(await page.evaluate(() => document.fullscreenElement),null);
  await expect(first.locator('#profile')).toBeVisible();
  await expect(first.locator('#compact-controls')).toBeHidden();
  await page.evaluate(() => {delete document.querySelector('#first').firstElementChild.requestFullscreen;});
  await fullscreen(true);
  await select('options');
  await first.locator('#quality').focus();
  await api('setAdvancedSync',true);
  await expect(first.locator('#compact-options-toggle')).toBeFocused();
  await api('setAdvancedSync',false);
  await select('options');
  await first.locator('#quality').focus();
  await api('setAdvancedSync',false);
  await expect(first.locator('#quality')).toBeFocused();
  await close();
  await api('seek',0);
  await select('profile');
  const seekBox = await first.locator('#profile').boundingBox();
  await page.mouse.move(seekBox.x+seekBox.width/2,seekBox.y+20);
  await page.mouse.down();
  await api('setAdvancedSync',true);
  assert.ok(Math.abs((await state()).elapsed-10) < 0.1,'hiding Profile settles its queued midpoint seek');
  assert.equal(await first.locator('#profile').evaluate(node => node.hasPointerCapture(1)),false);
  await page.mouse.move(seekBox.x+seekBox.width,seekBox.y+20);
  await page.mouse.up();
  assert.ok(Math.abs((await state()).elapsed-10) < 0.1,'hidden Profile no longer drags');
  await api('setAdvancedSync',false);
  await page.evaluate(async () => {
    window.compactSourceFailed = true;
    await window.demo.players[0].load(window.compactManifest, {
      baseUrl:new URL('/fixtures/regression/manifest.json',location.href).href,
      resolveSource:request => request.quality === 'detail' && window.compactSourceFailed
        ? {status:'failed',message:'Temporary test failure',retryable:true}
        : {status:'source',source:{quality:request.quality,url:new URL('/fixtures/regression/demo.webm',location.href).href,mediaStartSeconds:1}},
    });
  });
  await expect.poll(async () => (await state()).quality.active).toBe('economy');
  await select('options');
  await first.locator('#quality').selectOption('detail');
  await expect(first.locator('#quality-retry')).toBeVisible();
  await first.locator('#quality-retry').scrollIntoViewIfNeeded();
  await expect(first.locator('#quality-status')).toContainText('Could not apply');
  await page.evaluate(() => {window.compactSourceFailed = false;});
  await first.locator('#quality-retry').click();
  await expect.poll(async () => (await state()).quality.active).toBe('detail');
  await expect(first.locator('#quality-retry')).toBeHidden();
  assert.equal(await first.locator('video').evaluate(video => video.readyState >= 2 && video.videoWidth > 0),true);
  await close();
  await page.evaluate(async () => {
    const manifest = structuredClone(window.compactManifest);
    manifest.qualities.options = [{id:'economy',label:'Data saver'}];
    manifest.clips = manifest.clips.map(clip => ({...clip,sources:{economy:clip.sources.economy}}));
    await window.demo.players[0].load(manifest,{baseUrl:new URL('/fixtures/regression/manifest.json',location.href).href});
  });
  await first.locator('.player').focus();
  await page.keyboard.press('q');
  await expect(first.locator('#compact-details')).toBeHidden();
  await select('profile');
  const profileBox = await first.locator('#profile').boundingBox();
  await page.mouse.move(profileBox.x+80,profileBox.y+20);
  await page.mouse.down();
  await page.evaluate(() => {window.detachedCompactControls = ['compact-profile-toggle','compact-options-toggle','compact-close']
    .map(id => document.querySelector('#first').firstElementChild.shadowRoot.getElementById(id));});
  await api('destroy');
  await page.mouse.up();
  await resize({width:844,height:390});
  await expect(first.locator('.player')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await page.evaluate(() => {
    window.detachedCompactControls.forEach(button => button.click());
    window.demo.players[1].destroy();
  });
  assert.deepEqual(errors,[]);
  console.log(`Compact fullscreen passed. Screenshots saved to ${screenshots}`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
