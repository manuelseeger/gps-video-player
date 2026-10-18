import test from 'node:test';
import assert from 'node:assert/strict';
import {Playback} from './playback.js';
import {Timeline} from './timeline.js';
class Media extends EventTarget {
  constructor(){super();this.currentTime=0;this.duration=20;this.readyState=0;this.paused=true;this.seeking=false;}
  load(){} removeAttribute(){} pause(){this.paused=true;}
  play(){this.paused=false;this.dispatchEvent(new Event('playing'));return Promise.resolve();}
  ready(){this.readyState=4;this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('canplay'));}
}
test('trimmed media seeks and clocks subtract the media offset, and stop at trim end',async()=>{
  const timeline=new Timeline({clips:[{src:'https://media.test/video.webm',startUtcSeconds:100,durationSeconds:4,mediaOffsetSeconds:6}]},100,112);
  const media=[], errors=[];
  const p=new Playback(timeline,{createMedia:()=>{const m=new Media();media.push(m);return m;},clearMedia:()=>{},onError:e=>errors.push(e)});
  p.seek(1);media[0].ready();assert.equal(media[0].currentTime,7);
  p.play();await Promise.resolve();media[0].currentTime=8.5;p.tick();assert.equal(p.elapsed,2.5);
  media[0].currentTime=10.1;p.tick();assert.equal(p.elapsed,4);assert.equal(p.phase,'gap');assert.equal(p.media,null);assert.equal(media[0].paused,true);
  assert.deepEqual(errors,[]);p.destroy();
});
test('destroy invalidates pending media and removes play intent',async()=>{
  const timeline=new Timeline({clips:[{src:'https://media.test/v',startUtcSeconds:100,durationSeconds:4,mediaOffsetSeconds:0}]},100,112);
  let media, resolve, cleared=0;
  const p=new Playback(timeline,{createMedia:()=>media=new Media(),clearMedia:()=>cleared++});
  p.seek(1);media.play=()=>new Promise(r=>resolve=r);p.play();media.ready();
  p.destroy();media.paused=false;resolve();await Promise.resolve();
  assert.equal(media.paused,true);assert.equal(p.playing,false);assert.equal(p.media,null);assert.ok(cleared>=2);
});
