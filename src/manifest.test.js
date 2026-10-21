import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateManifest, utcInstant, loadManifest, createResourceLoader, resolveStyle} from './manifest.js';
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/regression/manifest.json',import.meta.url)));
const base='https://app.test/data/manifest.json';
const copy=()=>structuredClone(fixture);
test('v1 resolves relative URLs and keeps metadata and trim ranges',()=>{
  const m=validateManifest(fixture,base);
  assert.equal(m.track.url,'https://app.test/data/track.igc');assert.equal(m.sources[0].original.url,'https://app.test/data/demo.webm');
  assert.equal(m.sources[0].original.mediaStartSeconds,1);assert.equal(m.clips[1].startUtcSeconds-m.clips[0].startUtcSeconds,6);
  assert.equal(m.metadata.title,fixture.metadata.title);
  const inline=copy();delete inline.track.url;inline.track.igc='data';inline.clips=[];
  assert.equal(validateManifest(inline,base).track.igc,'data');
});
test('v1 blobs declare ownership without storing a lease on the logical clip', () => {
  const raw = copy();
  raw.clips[0].url = 'blob:https://app.test/owned';
  assert.throws(() => validateManifest(raw, base), /ownership/);
  const release = () => {};
  raw.clips[0].release = release;
  const manifest = validateManifest(raw, base);
  assert.equal(manifest.sources[0].original.release, release);
  assert.equal(manifest.clips[0].release, undefined);
});
test('v2 resolves static descriptors against the owning document without changing logical clips', () => {
  const raw = copy();
  raw.version = 2;
  raw.qualities = {options: [{id: 'economy', label: 'Data saver'}, {id: 'detail', label: 'Fine view'}], default: 'detail', fallback: ['economy']};
  raw.clips = [{startUtc: raw.clips[0].startUtc, durationSeconds: 4, sources: {
    economy: {url: './unrelated.webm?sig=%7Bx%7D&a=a+b', mediaStartSeconds: 2},
    detail: {url: 'https://other.test/opaque', type: 'video/mp4', mediaStartSeconds: 7},
  }}, {startUtc: raw.clips[1].startUtc, durationSeconds: 4, sources: {economy: {url: './later'}}}];
  const m = validateManifest(raw, base);
  assert.equal(m.sources[0].economy.url, 'https://app.test/data/unrelated.webm?sig=%7Bx%7D&a=a+b');
  assert.equal(m.sources[0].detail.mediaStartSeconds, 7);
  assert.deepEqual(m.qualities.availability, [{economy: 'available', detail: 'available'}, {economy: 'available', detail: 'unavailable'}]);
  assert.equal(m.clips[0].src, undefined);
  assert.equal(m.clips[0].mediaOffsetSeconds, undefined);
  raw.clips[0].sources.other = {url: './unknown'};
  assert.throws(() => validateManifest(raw, base), /catalogue/);
});
test('strict UTC timestamps reject ambiguous, impossible or normalized dates',()=>{
  for(const v of ['2030-02-30T00:00:00Z','2030-01-01','2030-01-01T00:00:00+00:00','2030-01-01T24:00:00Z','2030-01-01T00:00:60Z','2030-01-01T00:00:00.0000Z',NaN,null]) assert.throws(()=>utcInstant(v));
  assert.equal(utcInstant('2032-02-29T00:00:00.1Z'),Date.parse('2032-02-29T00:00:00.100Z')/1000);
});
test('invalid contract and unsafe URL schemes fail before resource loads',()=>{
  const changes=[m=>m.version=2,m=>delete m.track.startUtc,m=>m.track.igc='duplicate',m=>{delete m.track.url;m.track.igc=123;},m=>{m.track.url='./t.igc';m.track.igc=123;},m=>{delete m.track.igc;m.track.url=123;},m=>{m.track.igc='data';m.track.url=123;},m=>{delete m.track.url;m.track.igc=null;},m=>m.clips[0].durationSeconds=0,m=>m.clips[0].durationSeconds=Infinity,m=>m.clips[0].mediaOffsetSeconds=-1,m=>m.clips.reverse(),m=>m.clips[1].startUtc=m.clips[0].startUtc,m=>m.metadata.title={},m=>m.map.terrain={source:'x',exaggeration:-1},m=>m.track.url='file:///etc/passwd',m=>m.clips[0].url='javascript:alert(1)',m=>m.clips[0].url='https://user:pass@app.test/a',m=>m.metadata.timeZone='bad'];
  for(const change of changes){const m=copy();change(m);assert.throws(()=>validateManifest(m,base));}
  assert.throws(()=>validateManifest(fixture));
});
test('final response URL anchors manifest URLs after redirects',async()=>{
  const calls=[];
  const fetch=async(url,init)=>{
    calls.push([url,init]);
    if(calls.length===1)return {ok:true,url:'https://cdn.test/release/manifest.json',json:async()=>fixture};
    return {ok:true,text:async()=> 'IGC'};
  };
  const result=await loadManifest(base,{fetch},new AbortController().signal);
  assert.equal(result.manifest.sources[0].original.url,'https://cdn.test/release/demo.webm');
  assert.equal(calls[1][0],'https://cdn.test/release/track.igc');
});
test('auth headers and cookies are origin-scoped; authenticated redirects fail closed',async()=>{
  const calls=[];const signal=new AbortController().signal;
  const load=createResourceLoader({authOrigin:'https://app.test',request:{headers:{Authorization:'Bearer secret','X-Key':'secret'},credentials:'include'},fetch:async(...args)=>{calls.push(args);return {ok:true};}},base);
  await load(base,signal);await load('https://other.test/track',signal);
  assert.equal(calls[0][1].headers.get('Authorization'),'Bearer secret');assert.equal(calls[0][1].redirect,'error');assert.equal(calls[0][1].credentials,'include');
  assert.deepEqual([...calls[1][1].headers],[]);assert.equal(calls[1][1].credentials,'omit');assert.equal(calls[1][1].redirect,'follow');assert.equal(calls[1][1].signal,signal);
});
test('headers or ambient credentials require an explicit safe authOrigin before fetching',()=>{
  let calls=0;
  const fetch=()=>{calls++;throw Error('Unexpected fetch');};
  for(const request of [{headers:{Accept:'application/json'}},{headers:[['X-Key','secret']]},{headers:new Headers({Authorization:'secret'})},{credentials:'same-origin'},{credentials:'include'}]) {
    assert.throws(()=>createResourceLoader({fetch,request},base),/Explicit authOrigin/);
    for(const authOrigin of ['',null]) assert.throws(()=>createResourceLoader({fetch,request,authOrigin},base),/Explicit authOrigin/);
    for(const authOrigin of ['relative','file:///tmp/key','https://user:pass@app.test']) assert.throws(()=>createResourceLoader({fetch,request,authOrigin},base));
  }
  assert.doesNotThrow(()=>createResourceLoader({fetch,request:{headers:{},credentials:'omit'}}));
  assert.equal(calls,0);
});
test('successive manifest origins never become implicit authentication targets',async()=>{
  const calls=[];
  const options={authOrigin:'https://app.test',request:{headers:{'X-Key':'secret'},credentials:'include'},fetch:async(url,init)=>{
    calls.push({url,init});
    return url.endsWith('.json') ? {ok:true,url,json:async()=>fixture} : {ok:true,text:async()=> 'IGC'};
  }};
  await loadManifest(base,options);
  await loadManifest('https://other.test/data/manifest.json',options);
  assert.equal(calls.length,4);
  for(const {url,init} of calls) {
    const trusted=new URL(url).origin==='https://app.test';
    assert.equal(init.headers.get('X-Key'),trusted?'secret':null);
    assert.equal(init.credentials,trusted?'include':'omit');
    assert.equal(init.redirect,trusted?'error':'follow');
  }
  await assert.rejects(loadManifest('https://other.test/manifest.json',{...options,authOrigin:undefined}),/Explicit authOrigin/);
  assert.equal(calls.length,4);
});
test('style templates preserve encoded braces and signed data while resolving literal tokens',async()=>{
  const style=await resolveStyle({style:{version:8,sources:{tiles:{type:'raster',tiles:[
    './{z}/{x}/{y}.png?signature=%7Bopaque%7D&encoded=%7bz%7d&literal={ratio}',
    './%7Bz%7D/%7bx%7d.png?json=%7B%22x%22%3A1%7D',
    './gps-video-player-template-0-end/{quadkey}.png?value=%257Bz%257D',
  ]}},layers:[],glyphs:'./{fontstack}/{range}.pbf?data=%7Bfontstack%7D'}},base,()=>{throw Error('Unexpected fetch');});
  assert.deepEqual(style.sources.tiles.tiles,[
    'https://app.test/data/{z}/{x}/{y}.png?signature=%7Bopaque%7D&encoded=%7bz%7d&literal={ratio}',
    'https://app.test/data/%7Bz%7D/%7bx%7d.png?json=%7B%22x%22%3A1%7D',
    'https://app.test/data/gps-video-player-template-0-end/{quadkey}.png?value=%257Bz%257D',
  ]);
  assert.equal(style.glyphs,'https://app.test/data/{fontstack}/{range}.pbf?data=%7Bfontstack%7D');
});
test('style and TileJSON redirect bases resolve tiles, glyphs and sprites',async()=>{
  const load=async url=> url.endsWith('style.json') ? {url:'https://maps.test/v2/style.json',json:async()=>({version:8,sources:{dem:{type:'raster-dem',url:'./tiles.json'}},layers:[],glyphs:'./fonts/{fontstack}/{range}.pbf',sprite:'./sprite'})} : {url:'https://tiles.test/v3/tiles.json',json:async()=>({tiles:['./{z}/{x}/{y}.png']})};
  const style=await resolveStyle({style:'https://maps.test/style.json',terrain:{source:'dem'}},base,load);
  assert.equal(style.sources.dem.tiles[0],'https://tiles.test/v3/{z}/{x}/{y}.png');assert.equal(style.sources.dem.url,undefined);
  assert.equal(style.glyphs,'https://maps.test/v2/fonts/{fontstack}/{range}.pbf');assert.equal(style.sprite,'https://maps.test/v2/sprite');
});
test('HTTP failures are surfaced and inline loading uses adapter and baseUrl',async()=>{
  await assert.rejects(loadManifest(base,{fetch:async()=>({ok:false,status:403})}),/403/);
  const m=copy();delete m.track.url;m.track.igc='inline';
  const result=await loadManifest(m,{baseUrl:base,fetch:()=>{throw Error('Unexpected fetch');}});
  assert.equal(result.igc,'inline');
});
