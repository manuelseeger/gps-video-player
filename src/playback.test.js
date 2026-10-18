import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Playback} from './playback.js';
import {Timeline} from './timeline.js';

class Media extends EventTarget {
  constructor() { super(); this.currentTime=0; this.duration=10; this.readyState=0; this.paused=true; this.seeking=false; this.hidden=true; this.playCalls=0; this.defaultPlaybackRate=1; }
  emit(type) { this.dispatchEvent(new Event(type)); }
  load() { this.playbackRate=this.defaultPlaybackRate; }
  removeAttribute() {}
  pause() { this.paused=true; this.emit('pause'); }
  play() {
    ++this.playCalls;
    if (this.deferred) return this.deferred;
    this.paused=false;
    this.emit('playing');
    return Promise.resolve();
  }
  ready() { this.readyState=1; this.emit('loadedmetadata'); this.readyState=4; this.emit('canplay'); }
}
function setup(flightEnd=160) {
  let now=0;
  const media=[], errors=[];
  let clears=0;
  const timeline=new Timeline({clips:[
    {src:'/clips/a.mp4',startUtcSeconds:100,durationSeconds:10},
    {src:'/clips/b.mp4',startUtcSeconds:110,durationSeconds:10},
    {src:'/clips/c.mp4',startUtcSeconds:130,durationSeconds:10},
  ]},95,flightEnd);
  const p=new Playback(timeline,{createMedia:()=>{const m=new Media();media.push(m);return m;},clearMedia:()=>++clears,now:()=>now,onError:e=>errors.push(e)});
  return {p,media,errors,get clears(){return clears;},advance:ms=>{now+=ms;p.tick();}};
}

test('Play reloads a failed source and preserves the timeline position', () => {
  const {p,media}=setup();
  p.seek(3);media[0].error={message:'network failed'};media[0].emit('error');
  p.play();
  assert.equal(media.length,2);assert.equal(p.phase,'loading');assert.equal(p.playing,true);
  media[1].ready();
  assert.equal(media[1].currentTime,3);assert.equal(p.phase,'playing');
});

test('stalled loads stop after 30 seconds and Play retries', () => {
  const {p,media,errors,advance}=setup();
  p.seek(3);p.play();advance(30001);
  assert.equal(p.phase,'error');assert.equal(p.playing,false);assert.equal(errors.length,1);
  p.play();media[1].ready();assert.equal(p.phase,'playing');
});

test('external pause updates intent and late waiting cannot undo pause', async () => {
  const {p,media}=setup();
  p.seek(3);p.play();media[0].ready();await Promise.resolve();
  media[0].pause();
  assert.equal(p.playing,false);assert.equal(p.phase,'paused');
  media[0].emit('waiting');assert.equal(p.phase,'paused');
  p.play();await Promise.resolve();media[0].emit('waiting');p.pause();
  assert.equal(p.phase,'paused');
});

test('rounded UTC boundary enters the next clip instead of skipping it', () => {
  const origin=6.8999999999999915, start=135.099999999998;
  const {p,media,advance}=setup(160);
  p.timeline=new Timeline({clips:[
    {src:'/clips/a.mp4',startUtcSeconds:origin,durationSeconds:10},
    {src:'/clips/b.mp4',startUtcSeconds:start,durationSeconds:10},
  ]},0,160);
  p.seek(start-origin-1);p.play();advance(2000);
  assert.equal(p.state.clipIndex,1);assert.equal(p.phase,'loading');
  media[0].ready();assert.equal(media[0].currentTime,0);
});

test('duration mismatch reports a manifest warning', () => {
  const {p,media,errors}=setup();
  p.seek(3);media[0].duration=8;media[0].ready();
  assert.match(errors[0],/shorter/);assert.equal(p.phase,'paused');
});

test('initial load and seek preserve pause and local clip time', () => {
  const {p,media,advance}=setup();
  p.seek(12.5);
  assert.equal(p.state.clipIndex,1);
  assert.equal(p.phase,'loading');
  assert.equal(media[0].hidden,true);
  media[0].ready();
  assert.equal(media[0].currentTime,2.5);
  assert.equal(media[0].hidden,false);
  assert.equal(p.phase,'paused');
  advance(5000);
  assert.equal(p.elapsed,12.5);
  assert.equal(media[0].playCalls,0);
});

test('media time, not wall time, drives clips; buffering freezes timeline', async () => {
  const {p,media,advance}=setup();
  p.seek(2);p.play();advance(5000);
  assert.equal(p.elapsed,2);
  media[0].ready();await Promise.resolve();
  media[0].currentTime=3.25;advance(9000);
  assert.equal(p.elapsed,3.25);
  media[0].emit('waiting');
  media[0].currentTime=4;advance(9000);
  assert.equal(p.elapsed,3.25);
  assert.equal(p.phase,'buffering');
  media[0].emit('canplay');advance(100);
  assert.equal(p.elapsed,4);
});

test('gap clock supports pause, rate, boundary loading, and flight after all clips', () => {
  const {p,media,advance}=setup();
  p.seek(21);assert.equal(p.phase,'gap');assert.equal(p.media,null);
  p.play();advance(1000);assert.equal(p.elapsed,22);
  p.setRate(2);advance(1000);assert.equal(p.elapsed,24);
  p.pause();advance(10000);assert.equal(p.elapsed,24);
  p.play();advance(3000);
  assert.equal(p.elapsed,30);assert.equal(p.phase,'loading');assert.equal(media.length,1);
  advance(2000);assert.equal(p.elapsed,30);
  p.seek(45);advance(1000);assert.equal(p.elapsed,47);
  advance(100000);assert.equal(p.elapsed,60);assert.equal(p.playing,false);
});

test('adjacent clips switch at boundary and inherit playback rate and audio', async () => {
  const {p,media,advance}=setup();
  p.setRate(4);p.setAudio(.4,true);p.seek(9);p.play();media[0].ready();await Promise.resolve();
  media[0].currentTime=10;advance(16);
  assert.equal(p.state.clipIndex,1);assert.equal(p.elapsed,10);assert.equal(p.playing,true);
  assert.equal(media[0].paused,true);assert.equal(media[1].hidden,true);
  assert.equal(media[1].volume,.4);assert.equal(media[1].muted,true);assert.equal(media[1].playbackRate,4);
  media[1].ready();assert.equal(p.phase,'playing');
  media[1].emit('ended');
  assert.equal(p.phase,'gap');assert.equal(p.elapsed,20);assert.equal(p.media,null);
});

test('paused file switches stay paused, including a seek into a gap', () => {
  const {p,media,advance}=setup();
  p.seek(2);media[0].ready();p.seek(31);media[1].ready();
  assert.equal(media[1].playCalls,0);assert.equal(p.playing,false);
  p.seek(25);assert.equal(p.media,null);advance(2000);assert.equal(p.elapsed,25);
});

test('rapid seeks ignore all stale events and an aborted play promise', async () => {
  const {p,media,errors,advance}=setup();
  let reject;
  p.seek(1);media[0].deferred=new Promise((_,r)=>reject=r);
  p.play();media[0].ready();
  p.seek(12);p.seek(31);p.pause();
  media[2].ready();
  for (const old of media.slice(0,2)) {
    old.ready();old.paused=false;old.emit('playing');old.emit('waiting');old.emit('ended');old.emit('error');
    assert.equal(old.paused,true,'Retired media must not resume audio');
  }
  reject(Object.assign(new Error('interrupted'),{name:'AbortError'}));
  await Promise.resolve();advance(1000);
  assert.equal(p.elapsed,31);assert.equal(p.state.clipIndex,2);assert.equal(p.playing,false);
  assert.equal(p.phase,'paused');assert.equal(media[2].playCalls,0);assert.deepEqual(errors,[]);
});

test('pause while play is pending prevents a late promise/event from resuming', async () => {
  const {p,media}=setup();
  let resolve;
  p.seek(1);media[0].deferred=new Promise(r=>resolve=r);p.play();media[0].ready();p.pause();
  media[0].paused=false;media[0].emit('playing');resolve();await Promise.resolve();
  assert.equal(p.playing,false);assert.equal(media[0].paused,true);assert.equal(p.elapsed,1);
});

test('play after a pending pause retries an interrupted active play request', async () => {
  const {p,media}=setup();
  let reject;
  p.seek(1);media[0].deferred=new Promise((_,r)=>reject=r);p.play();media[0].ready();
  p.pause();p.play();
  media[0].deferred=null;
  reject(Object.assign(new Error('interrupted'),{name:'AbortError'}));
  await Promise.resolve();await Promise.resolve();
  assert.equal(media[0].playCalls,2);assert.equal(p.playing,true);assert.equal(p.phase,'playing');
});

test('nudge does not move clip time; track endpoints remain seekable', () => {
  const {p,media}=setup();
  p.seek(5);media[0].ready();p.setNudge(2);
  assert.equal(p.elapsed,5);assert.equal(p.state.utc,107);assert.equal(p.state.clipIndex,0);
  p.seek(p.timeline.elapsedAtUtc(160,p.nudge));
  assert.equal(p.elapsed,58);assert.equal(p.phase,'gap');assert.equal(p.state.utc,160);
});

test('gap time before video runs to the first clip, without skipping clips after long delays', () => {
  const {p,advance}=setup();
  p.seek(-5);p.play();advance(100000);
  assert.equal(p.elapsed,0);assert.equal(p.state.clipIndex,0);assert.equal(p.phase,'loading');
});

test('media errors are reported only by the active source; replay from end resets timeline', () => {
  const {p,media,errors}=setup();
  p.seek(1);media[0].error={message:'decoder error'};media[0].emit('error');
  assert.deepEqual(errors,['decoder error']);assert.equal(p.phase,'error');assert.equal(p.playing,false);
  p.seek(60);p.play();assert.equal(p.elapsed,-5);assert.equal(p.playing,true);
});

test('invalid control inputs cannot corrupt the clock', () => {
  const {p}=setup();p.seek(20);
  p.seek(NaN);p.seek(Infinity);p.setRate(0);p.setRate(NaN);p.setNudge(Infinity);
  assert.equal(p.elapsed,20);assert.equal(p.rate,1);assert.equal(p.nudge,0);
});
