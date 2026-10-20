import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Timeline} from './timeline.js';
const clip=(start,duration=10)=>({src:'https://media.test/a.webm',startUtcSeconds:start,durationSeconds:duration,mediaOffsetSeconds:0});
const manifest={clips:[clip(100),clip(110),clip(130)]};
test('half-open intervals, contiguous boundaries and gaps',()=>{
  const t=new Timeline(manifest,90,160);
  assert.equal(t.locate(-.001),null);assert.equal(t.locate(0).index,0);assert.equal(t.locate(9.75).localTime,9.75);
  assert.equal(t.locate(10).index,1);assert.equal(t.locate(20),null);assert.equal(t.locate(30).index,2);assert.equal(t.locate(40),null);
  assert.deepEqual(t.bounds(),{start:-10,end:60});assert.equal(t.clamp(100),60);assert.equal(t.clamp(-100),-10);
});
test('nudge changes track UTC, not clip positions',()=>{
  const t=new Timeline(manifest,90,160);
  assert.equal(t.trackUtc(10,2.5),112.5);assert.equal(t.elapsedAtUtc(112.5,2.5),10);
  assert.deepEqual(t.bounds(20),{start:-30,end:40});assert.deepEqual(t.bounds(-20),{start:0,end:80});
  for(const n of [-1000,0,1000]) for(const utc of [90,160]) assert.equal(t.clamp(t.elapsedAtUtc(utc,n),n),t.elapsedAtUtc(utc,n));
});
test('coverage clips and shifts track UTC spans without media offsets',()=>{
  const t=new Timeline({clips:[{...clip(100,4),mediaOffsetSeconds:30},clip(106,4)]},101,109);
  assert.deepEqual(t.coverage(),[{start:101,end:104},{start:106,end:109}]);
  assert.deepEqual(t.coverage(2),[{start:102,end:106},{start:108,end:109}]);
  assert.deepEqual(t.coverage(-2),[{start:101,end:102},{start:104,end:108}]);
  assert.deepEqual(t.coverage(.25),[{start:101,end:104.25},{start:106.25,end:109}]);
  assert.deepEqual(t.coverage(-.25),[{start:101,end:103.75},{start:105.75,end:109}]);
  assert.deepEqual(t.coverage(20),[]);
  assert.deepEqual(t.coverage(-20),[]);
});
test('coverage merges only touching or overlapping clips and retains tiny gaps',()=>{
  const t=new Timeline({clips:[clip(100,4),clip(104,4),clip(107,3),clip(110.0001,2)]},90,120);
  assert.deepEqual(t.coverage(),[{start:100,end:110},{start:110.0001,end:112.0001}]);
  assert.deepEqual(new Timeline({clips:[clip(100,4),clip(106,4)]},100,120).coverage(),[{start:100,end:104},{start:106,end:110}]);
});
test('coverage excludes empty clips and zero flight extents',()=>{
  assert.deepEqual(new Timeline({clips:[]},100,120).coverage(),[]);
  assert.deepEqual(new Timeline({clips:[clip(100)]},105,105).coverage(),[]);
  assert.deepEqual(new Timeline({clips:[clip(100,0),clip(101,1)]},100,102).coverage(),[{start:101,end:102}]);
});
test('track-only and multi-date UTC extents',()=>{
  const a=Date.parse('2030-01-01T23:59:55Z')/1000;
  const t=new Timeline({clips:[clip(a,10),clip(a+15,10)]},a-5,a+40);
  assert.equal(t.trackUtc(20),a+20);assert.equal(t.locate(15).localTime,0);
  assert.deepEqual(new Timeline({clips:[]},a,a+20).bounds(),{start:0,end:20});
  assert.throws(()=>new Timeline(manifest,110,100));
});
