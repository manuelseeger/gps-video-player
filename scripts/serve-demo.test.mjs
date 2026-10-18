import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDemoServer} from '../tests/server.mjs';
import {createDemoServer as createPageServer} from '../demo/server.mjs';

test('demo page server does not expose test pages or fixtures', async()=>{
  const server=createPageServer();server.listen(0,'0.0.0.0');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base)).status,200);
    const page=await (await fetch(base)).text();
    assert.doesNotMatch(page,/regression|integration/);
    for (const route of ['/integration.html','/integration.js','/fixtures/regression/manifest.json','/demo/regression/manifest.json','/redirect']) {
      assert.equal((await fetch(base+route)).status,404,route);
    }
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('test server adds offline integration fixtures to demo routes',async()=>{
  const server=createDemoServer();server.listen(0,'0.0.0.0');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const single=await (await fetch(base)).text();
    assert.equal((single.match(/class="mount" data-player/g)||[]).length,1);
    const integration=await (await fetch(base+'/integration.html')).text();
    assert.equal((integration.match(/class="mount" data-player/g)||[]).length,2);
    assert.match(integration,/\/fixtures\/regression\/manifest.json/);
    const css=await fetch(base+'/demo.css');
    assert.equal(css.status,200);assert.equal(css.headers.get('content-type'),'text/css');
    const mountain=await (await fetch(base+'/demo/manifest.json')).json();
    assert.equal(mountain.clips[0].durationSeconds,90);
    assert.equal(mountain.map.terrain.source,'dem');
    const redirected=await fetch(base+'/redirect');
    assert.equal(redirected.url,base+'/fixtures/regression/manifest.json');
    assert.equal((await redirected.json()).clips[0].mediaOffsetSeconds,1);
    const range=await fetch(base+'/demo/demo.webm',{headers:{Range:'bytes=0-31'}});
    assert.equal(range.status,206);assert.match(range.headers.get('content-range'),/^bytes 0-31\//);
    assert.equal((await range.arrayBuffer()).byteLength,32);
    assert.equal((await fetch(base+'/fixtures/regression/terrain.png')).status,200);
    assert.equal((await fetch(base+'/.env')).status,404);
    assert.equal((await fetch(base+'/demo/%2e%2e/%2e%2e/package.json')).status,404);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
