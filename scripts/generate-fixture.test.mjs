import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {generateMountainFlight,encodeIGC,mountainManifest,phases} from './generate-fixture.mjs';
import {parseIGC,distance} from '../src/flight.js';
const dir=new URL('../demo/public/demo/',import.meta.url);
const igc=await readFile(new URL('track.igc',dir),'utf8');
const fixes=parseIGC(igc);
const delta=(a,b)=>((b-a+180)%360+360)%360-180;

test('mountain fixture is deterministic, anonymous and reproducible',async()=>{
  assert.equal(igc,encodeIGC(generateMountainFlight()));
  assert.equal(igc,encodeIGC(generateMountainFlight()));
  assert.deepEqual(JSON.parse(await readFile(new URL('manifest.json',dir))),mountainManifest());
  assert.match(igc,/SYNTHETIC FLIGHT - NO RECORDED PILOT DATA/);
  assert.doesNotMatch(igc,/^HF(?:PLT|CM2|CID)/m,'No personal IGC headers');
  assert.equal(fixes.length,91);
  assert.equal(fixes.at(-1).t-fixes[0].t,90);
  assert.ok(fixes.every((p,i)=>p.t===43200+i));
  assert.ok(fixes.every(p=>p.lat>45.83 && p.lat<45.87 && p.lon>6.21 && p.lon<6.25));
});

test('paragliding has sensible speeds, sink, lift and smooth turns',()=>{
  const speeds=fixes.slice(1).map((p,i)=>distance(fixes[i],p));
  assert.ok(speeds.every(s=>s>6.5 && s<13.5),'One-second ground speeds 23–49 km/h, including IGC coordinate quantization');
  assert.ok(fixes.every(p=>p.speed>7.2 && p.speed<12.8));
  const vertical=fixes.slice(1).map((p,i)=>p.alt-fixes[i].alt);
  assert.ok(vertical.every(v=>v>=-2 && v<=3),'Quantized vertical speeds remain plausible');
  assert.ok(fixes.every(p=>p.vario>=-1.6 && p.vario<=2.4));
  assert.ok(fixes.some(p=>p.vario<-1) && fixes.some(p=>p.vario>2));
  assert.ok(fixes.every(p=>p.alt>1750 && p.alt<2150),'MSL height in metres');
  assert.ok(fixes.slice(1).every((p,i)=>Math.abs(delta(fixes[i].heading,p.heading))<29),'Sharper thermal course changes including metre-scale IGC coordinate quantization');
  const length=speeds.reduce((s,v)=>s+v,0);
  assert.ok(length>850 && length<1000);
});

test('entry is +45 degrees; departure turns +40 right of thermal entry in eight seconds',()=>{
  const raw=generateMountainFlight();
  for(const [start,end,turn] of [[20,28,45],[60,68,40]]) {
    assert.equal(raw[end].airHeading-raw[start].airHeading,turn);
    for(let t=start;t<end;t++) assert.equal(raw[t+1].airHeading-raw[t].airHeading,turn/8);
  }
  assert.equal(delta(raw[28].airHeading,raw[68].airHeading),40,'Departure is 40 degrees right of thermal entry, not initial glide');
  assert.equal(raw[68].airHeading-raw[28].airHeading,760,'Two full circles plus 40 degrees');
  assert.equal(raw[68].airHeading-raw[0].airHeading,805,'Preserve the prior +45 entry');
  assert.ok(raw.slice(20,68).every((p,i)=>raw[21+i].airHeading>p.airHeading),'No turn reversal during entry, thermal or departure');
  for(const [start,end] of [[0,20],[68,90]]) {
    for(let t=start;t<end;t++) assert.equal(raw[t+1].airHeading,raw[t].airHeading,'Straight glides do not turn');
  }
});

test('exactly two 16-second air-relative rotations in one 32-second thermal',()=>{
  const raw=generateMountainFlight();
  // Verify the actual integrated air-relative displacement, not ground course
  // (which includes wind) or only the configured phase turn rate.
  for(let t=0;t<90;t++) {
    const a=raw[t],b=raw[t+1];
    const north=(b.lat-a.lat)*111195-.3;
    const east=(b.lon-a.lon)*111195*Math.cos(b.lat*Math.PI/180)-.8;
    const heading=Math.atan2(east,north)*180/Math.PI;
    assert.ok(Math.abs(delta(b.airHeading,heading))<1e-7);
    assert.ok(Math.abs(Math.hypot(east,north)-b.airSpeed)<1e-7);
    const turn=b.airHeading-a.airHeading;
    assert.ok(Math.abs(turn-(t>=28 && t<60 ? 22.5 : phases.find(p=>t>=p.start && t<p.end).turn))<1e-10);
  }
  for(const start of [28,44]) {
    assert.ok(Math.abs(raw[start+16].airHeading-raw[start].airHeading-360)<1e-10);
    for(let t=start;t<start+16;t++) assert.ok(raw[t+1].alt>raw[t].alt,'Lift throughout both rotations');
  }
  assert.ok(Math.abs(raw[60].airHeading-raw[28].airHeading-720)<1e-10);
  const thermals=phases.filter(p=>Math.abs(p.turn)===22.5);
  assert.equal(thermals.length,1);
  assert.equal(thermals[0].start,28);
  assert.equal(thermals[0].end,60);
  assert.equal(thermals[0].end-thermals[0].start,32);
  assert.equal(thermals[0].turn,22.5);
  for(const phase of phases) {
    const section=fixes.slice(phase.start,phase.end+1);
    const turn=section.slice(1).reduce((s,p,i)=>s+delta(section[i].heading,p.heading),0);
    const climb=section.at(-1).alt-section[0].alt;
    if(Math.abs(phase.turn)===22.5) {
      assert.ok(turn>690 && turn<750,'Two rotations in quantized, smoothed ground course' );
      assert.ok(climb>55 && climb<75,'Realistic thermal gain');
      assert.ok(distance(section[0],section.at(-1))<40,'Circle closes with mild wind drift');
    } else if(phase.turn!==0) {
      assert.ok(turn*Math.sign(phase.turn)>25 && turn*Math.sign(phase.turn)<75,'Visible entry/exit ground turns retain their direction despite wind and boundary smoothing');
    } else {
      assert.ok(Math.abs(turn)<30,'Smoothed ground course includes turn boundary samples; exact air turns are checked above');
      assert.ok(climb<-5,'Straight glides lose height');
    }
  }
});

test('all fixes have safe synthetic clearance over the stored real DEM profile',async()=>{
  const ground=JSON.parse(await readFile(new URL('../tests/fixtures/ground-reference.json',import.meta.url)));
  assert.equal(ground.trackSha256,createHash('sha256').update(igc).digest('hex'),'Refresh the real terrain profile after track changes');
  assert.equal(ground.heights.length,fixes.length);
  assert.equal(ground.zoom,14);
  assert.ok(ground.heights.every(h=>Number.isFinite(h) && h>700 && h<1400));
  assert.ok(Math.max(...ground.heights)-Math.min(...ground.heights)>80,'Route crosses sloping real terrain');
  assert.ok(fixes.every((p,i)=>p.alt-ground.heights[i]>150 && p.alt-ground.heights[i]<1300));
});

test('only the public demo selects providers; test fixture stays offline',async()=>{
  const manifest=mountainManifest();
  assert.equal(manifest.map.terrain.exaggeration,1);
  assert.equal(manifest.map.style.sources.dem.encoding,'terrarium');
  assert.equal(manifest.clips[0].durationSeconds,90);
  assert.match(manifest.metadata.description,/not flight-camera footage/);
  const regression=JSON.parse(await readFile(new URL('../tests/fixtures/regression/manifest.json',import.meta.url)));
  assert.deepEqual(regression.map.style.sources,{});
  assert.equal(parseIGC(await readFile(new URL('../tests/fixtures/regression/track.igc',import.meta.url),'utf8')).length,21);
  assert.ok(regression.clips.every(c=>c.durationSeconds===4));
});
