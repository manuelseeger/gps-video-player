import test from 'node:test';
import assert from 'node:assert/strict';
import {Playback} from './playback.js';
import {Timeline} from './timeline.js';
import {fixedSession, flush} from '../tests/playback-fixture.js';
class Media extends EventTarget {
  constructor(){super();this.currentTime=0;this.duration=20;this.readyState=0;this.videoWidth=640;this.paused=true;this.seeking=false;}
  load(){} removeAttribute(){} pause(){this.paused=true;}
  play(){this.paused=false;this.dispatchEvent(new Event('playing'));return Promise.resolve();}
  ready(){this.readyState=4;this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('canplay'));}
}
test('trimmed media seeks and clocks subtract the media offset, and stop at trim end',async()=>{
  const timeline=new Timeline({clips:[{src:'https://media.test/video.webm',startUtcSeconds:100,durationSeconds:4,mediaOffsetSeconds:6}]},100,112);
  const media=[], errors=[];
  const p=new Playback(timeline,{createMedia:()=>{const m=new Media();media.push(m);return m;},session:fixedSession(timeline.clips),removeMedia:()=>{},onError:e=>errors.push(e)});
  p.seek(1);await flush();media[0].ready();await flush();assert.equal(media[0].currentTime,7);
  p.play();await flush();media[0].currentTime=8.5;p.tick();assert.equal(p.elapsed,2.5);
  media[0].currentTime=10.1;p.tick();assert.equal(p.elapsed,4);assert.equal(p.phase,'gap');assert.equal(p.media,null);assert.equal(media[0].paused,true);
  assert.deepEqual(errors,[]);p.destroy();
});
test('destroy invalidates pending media and removes play intent',async()=>{
  const timeline=new Timeline({clips:[{src:'https://media.test/v',startUtcSeconds:100,durationSeconds:4,mediaOffsetSeconds:0}]},100,112);
  let media, resolve, cleared=0;
  const p=new Playback(timeline,{createMedia:()=>media=new Media(),session:fixedSession(timeline.clips),removeMedia:()=>cleared++});
  p.seek(1);await flush();media.play=()=>new Promise(r=>resolve=r);p.play();await flush();media.ready();await flush();
  p.destroy();media.paused=false;resolve();await flush();
  assert.equal(media.paused,true);assert.equal(p.playing,false);assert.equal(p.media,null);assert.equal(cleared,1);
});
test('media timeupdate enforces trim end without a manual tick and ignores retired media',async()=>{
  const timeline=new Timeline({clips:[{src:'https://media.test/video.webm',startUtcSeconds:100,durationSeconds:4,mediaOffsetSeconds:6}]},100,112);
  const media=[];
  const p=new Playback(timeline,{createMedia:()=>{const m=new Media();media.push(m);return m;},session:fixedSession(timeline.clips),removeMedia:()=>{}});
  p.seek(1);await flush();media[0].ready();await flush();p.play();await flush();
  media[0].currentTime=8.5;media[0].dispatchEvent(new Event('timeupdate'));
  assert.equal(p.elapsed,2.5);assert.equal(p.phase,'playing');
  media[0].currentTime=10.1;media[0].dispatchEvent(new Event('timeupdate'));
  assert.equal(p.elapsed,4);assert.equal(p.phase,'gap');assert.equal(p.media,null);assert.equal(media[0].paused,true);
  const state=p.state;
  media[0].currentTime=7;media[0].dispatchEvent(new Event('timeupdate'));
  assert.deepEqual(p.state,state);
  p.seek(1);await flush();media[1].ready();await flush();p.play();await flush();
  p.seek(2);await flush();media[0].currentTime=10.1;media[0].dispatchEvent(new Event('timeupdate'));
  assert.equal(p.elapsed,2);assert.equal(p.media,media[1]);assert.equal(p.media.currentTime,8);assert.equal(media.length,2);
  p.destroy();
});
