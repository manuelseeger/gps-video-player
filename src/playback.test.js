import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Playback} from './playback.js';
import {Timeline} from './timeline.js';
import {fixedSession, flush, clock} from '../tests/playback-fixture.js';

class Media extends EventTarget {
  constructor() { super(); this.currentTime=0; this.duration=10; this.readyState=0; this.videoWidth=640; this.paused=true; this.seeking=false; this.hidden=true; this.playCalls=0; this.defaultPlaybackRate=1; }
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
  const time=clock();
  const media=[], errors=[];
  let clears=0;
  const timeline=new Timeline({clips:[
    {src:'/clips/a.mp4',startUtcSeconds:100,durationSeconds:10},
    {src:'/clips/b.mp4',startUtcSeconds:110,durationSeconds:10},
    {src:'/clips/c.mp4',startUtcSeconds:130,durationSeconds:10},
  ]},95,flightEnd);
  const p=new Playback(timeline,{createMedia:()=>{const m=new Media();media.push(m);return m;},session:fixedSession(timeline.clips),removeMedia:()=>++clears,now:time.now,timers:time.timers,onError:e=>errors.push(e)});
  return {p,media,errors,get clears(){return clears;},advance:ms=>{time.advance(ms);p.tick();}};
}

test('Play reloads a failed source and preserves the timeline position', async () => {
  const {p,media}=setup();
  p.seek(3);await flush();media[0].error={message:'network failed'};media[0].emit('error');await flush();
  p.play();await flush();
  assert.equal(media.length,2);assert.equal(p.phase,'loading');assert.equal(p.playing,true);
  media[1].ready();await flush();
  assert.equal(media[1].currentTime,3);assert.equal(p.phase,'playing');
});

test('stalled loads stop after 30 seconds and Play retries', async () => {
  const {p,media,errors,advance}=setup();
  p.seek(3);await flush();p.play();await flush();advance(30001);await flush();
  assert.equal(p.phase,'error');assert.equal(p.playing,false);assert.equal(errors.length,1);
  p.play();await flush();media[1].ready();await flush();assert.equal(p.phase,'playing');
});

test('external pause updates intent and late waiting cannot undo pause', async () => {
  const {p,media}=setup();
  p.seek(3);await flush();p.play();await flush();media[0].ready();await flush();
  media[0].pause();
  assert.equal(p.playing,false);assert.equal(p.phase,'paused');
  media[0].emit('waiting');assert.equal(p.phase,'paused');
  p.play();await flush();media[0].emit('waiting');p.pause();await flush();
  assert.equal(p.phase,'paused');
});

test('rounded UTC boundary enters the next clip instead of skipping it', async () => {
  const origin=6.8999999999999915, start=135.099999999998;
  const {p,media,advance}=setup(160);
  p.timeline=new Timeline({clips:[
    {src:'/clips/a.mp4',startUtcSeconds:origin,durationSeconds:10},
    {src:'/clips/b.mp4',startUtcSeconds:start,durationSeconds:10},
  ]},0,160);
  p.seek(start-origin-1);await flush();p.play();await flush();advance(2000);await flush();
  assert.equal(p.state.clipIndex,1);assert.equal(p.phase,'loading');
  media[0].ready();await flush();assert.equal(media[0].currentTime,0);
});

test('duration mismatch stops at the same position with a mapping failure', async () => {
  const {p,media,errors}=setup();
  p.seek(3);await flush();media[0].duration=8;media[0].ready();await flush();
  assert.match(errors[0],/shorter/);assert.equal(p.phase,'error');assert.equal(p.elapsed,3);
});

test('initial load and seek preserve pause and local clip time', async () => {
  const {p,media,advance}=setup();
  p.seek(12.5);await flush();
  assert.equal(p.state.clipIndex,1);
  assert.equal(p.phase,'loading');
  assert.equal(media[0].hidden,true);
  media[0].ready();await flush();
  assert.equal(media[0].currentTime,2.5);
  assert.equal(media[0].hidden,false);
  assert.equal(p.phase,'paused');
  advance(5000);await flush();
  assert.equal(p.elapsed,12.5);
  assert.equal(media[0].playCalls,0);
});

test('media time, not wall time, drives clips; buffering freezes timeline', async () => {
  const {p,media,advance}=setup();
  p.seek(2);await flush();p.play();await flush();advance(5000);await flush();
  assert.equal(p.elapsed,2);
  media[0].ready();await flush();
  media[0].currentTime=3.25;advance(9000);await flush();
  assert.equal(p.elapsed,3.25);
  media[0].emit('waiting');
  media[0].currentTime=4;advance(9000);await flush();
  assert.equal(p.elapsed,3.25);
  assert.equal(p.phase,'buffering');
  media[0].emit('canplay');advance(100);await flush();
  assert.equal(p.elapsed,4);
});

test('gap clock supports pause, rate, boundary loading, and flight after all clips', async () => {
  const {p,media,advance}=setup();
  p.seek(21);await flush();assert.equal(p.phase,'gap');assert.equal(p.media,null);
  p.play();await flush();advance(1000);await flush();assert.equal(p.elapsed,22);
  p.setRate(2);advance(1000);await flush();assert.equal(p.elapsed,24);
  p.pause();await flush();advance(10000);await flush();assert.equal(p.elapsed,24);
  p.play();await flush();advance(3000);await flush();
  assert.equal(p.elapsed,30);assert.equal(p.phase,'loading');assert.equal(media.length,1);
  advance(2000);await flush();assert.equal(p.elapsed,30);
  p.seek(45);await flush();advance(1000);await flush();assert.equal(p.elapsed,47);
  advance(100000);await flush();assert.equal(p.elapsed,60);assert.equal(p.playing,false);
});

test('adjacent clips switch at boundary and inherit playback rate and audio', async () => {
  const {p,media,advance}=setup();
  p.setRate(4);p.setAudio(.4,true);p.seek(9);await flush();p.play();await flush();media[0].ready();await flush();
  media[0].currentTime=10;advance(16);await flush();
  assert.equal(p.state.clipIndex,1);assert.equal(p.elapsed,10);assert.equal(p.playing,true);
  assert.equal(media[0].paused,true);assert.equal(media[1].hidden,true);
  assert.equal(media[1].volume,.4);assert.equal(media[1].muted,true);assert.equal(media[1].playbackRate,4);
  media[1].ready();await flush();assert.equal(p.phase,'playing');
  media[1].emit('ended');
  assert.equal(p.phase,'gap');assert.equal(p.elapsed,20);assert.equal(p.media,null);
});

test('paused file switches stay paused, including a seek into a gap', async () => {
  const {p,media,advance}=setup();
  p.seek(2);await flush();media[0].ready();await flush();p.seek(31);await flush();media[1].ready();await flush();
  assert.equal(media[1].playCalls,0);assert.equal(p.playing,false);
  p.seek(25);await flush();assert.equal(p.media,null);advance(2000);await flush();assert.equal(p.elapsed,25);
});

test('rapid seeks ignore all stale events and an aborted play promise', async () => {
  const {p,media,errors,advance}=setup();
  let reject;
  p.seek(1);await flush();media[0].deferred=new Promise((_,r)=>reject=r);
  p.play();await flush();media[0].ready();await flush();
  p.seek(12);await flush();p.seek(31);await flush();p.pause();await flush();
  media[2].ready();await flush();
  for (const old of media.slice(0,2)) {
    old.ready();old.paused=false;old.emit('playing');old.emit('waiting');old.emit('ended');old.emit('error');await flush();
    assert.equal(old.paused,true,'Retired media must not resume audio');
  }
  reject(Object.assign(new Error('interrupted'),{name:'AbortError'}));
  await flush();advance(1000);await flush();
  assert.equal(p.elapsed,31);assert.equal(p.state.clipIndex,2);assert.equal(p.playing,false);
  assert.equal(p.phase,'paused');assert.equal(media[2].playCalls,0);assert.deepEqual(errors,[]);
});

test('pause while play is pending prevents a late promise/event from resuming', async () => {
  const {p,media}=setup();
  let resolve;
  p.seek(1);await flush();media[0].deferred=new Promise(r=>resolve=r);p.play();await flush();media[0].ready();await flush();p.pause();await flush();
  media[0].paused=false;media[0].emit('playing');resolve();await flush();
  assert.equal(p.playing,false);assert.equal(media[0].paused,true);assert.equal(p.elapsed,1);
});

test('play after a pending pause retries an interrupted active play request', async () => {
  const {p,media}=setup();
  let reject;
  p.seek(1);await flush();media[0].deferred=new Promise((_,r)=>reject=r);p.play();await flush();media[0].ready();await flush();
  p.pause();await flush();p.play();await flush();
  media[0].deferred=null;
  reject(Object.assign(new Error('interrupted'),{name:'AbortError'}));
  await flush();
  assert.equal(media[0].playCalls,2);assert.equal(p.playing,true);assert.equal(p.phase,'playing');
});

test('nudge does not move clip time; track endpoints remain seekable', async () => {
  const {p,media}=setup();
  p.seek(5);await flush();media[0].ready();await flush();p.setNudge(2);
  assert.equal(p.elapsed,5);assert.equal(p.state.utc,107);assert.equal(p.state.clipIndex,0);
  p.seek(p.timeline.elapsedAtUtc(160,p.nudge));await flush();
  assert.equal(p.elapsed,58);assert.equal(p.phase,'gap');assert.equal(p.state.utc,160);
});

test('gap time before video runs to the first clip, without skipping clips after long delays', async () => {
  const {p,advance}=setup();
  p.seek(-5);await flush();p.play();await flush();advance(100000);await flush();
  assert.equal(p.elapsed,0);assert.equal(p.state.clipIndex,0);assert.equal(p.phase,'loading');
});

test('media errors are reported only by the active source; replay from end resets timeline', async () => {
  const {p,media,errors}=setup();
  p.seek(1);await flush();media[0].error={message:'decoder error'};media[0].emit('error');await flush();
  assert.deepEqual(errors,['Video could not load or decode. Retry to continue.']);assert.equal(p.phase,'error');assert.equal(p.playing,false);
  p.seek(60);await flush();p.play();await flush();assert.equal(p.elapsed,-5);assert.equal(p.playing,true);
});

test('invalid control inputs cannot corrupt the clock', async () => {
  const {p}=setup();p.seek(20);await flush();
  p.seek(NaN);await flush();p.seek(Infinity);await flush();p.setRate(0);p.setRate(NaN);p.setNudge(Infinity);
  assert.equal(p.elapsed,20);assert.equal(p.rate,1);assert.equal(p.nudge,0);
});

test('unsupported rates leave state and media unchanged, before and after media exists', async () => {
  const {p,media}=setup();
  const invalid=[0,-1,NaN,Infinity,0.05,20,'2',null];
  for(const v of invalid){p.setRate(v);assert.equal(p.rate,1);}
  p.setRate(16);p.setRate(0.0625);assert.equal(p.rate,0.0625);p.setRate(1);
  p.seek(3);await flush();
  for(const v of invalid){p.setRate(v);assert.equal(p.rate,1);assert.equal(media[0].playbackRate,1);}
  p.setRate(16);assert.equal(media[0].playbackRate,16);
  const defaults=media[0].defaultPlaybackRate;
  p.setRate(20);assert.equal(p.rate,16);assert.equal(media[0].playbackRate,16);assert.equal(media[0].defaultPlaybackRate,defaults);
  p.seek(4);await flush();assert.equal(media.length,2);assert.equal(media[1].playbackRate,16);
});

test('Chromium-style range errors cannot poison later seeks', async () => {
  const {p,media}=setup();
  p.seek(3);await flush();
  let rate=1;
  Object.defineProperty(media[0],'playbackRate',{get:()=>rate,set:v=>{if(v>16)throw new DOMException('range','NotSupportedError');rate=v;}});
  p.setRate(20);
  assert.equal(p.rate,1);
  p.seek(5);await flush();assert.equal(media.length,2);assert.equal(media[1].playbackRate,1);
});
