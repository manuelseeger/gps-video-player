import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseIGC,sample,varioColor} from './flight.js';
const text=readFileSync(new URL('../tests/fixtures/regression/track.igc',import.meta.url),'utf8');
const fixes=parseIGC(text);
test('synthetic IGC parses GPS MSL altitude, decimal minutes and midnight',()=>{
  assert.equal(fixes.length,21);assert.equal(fixes[0].t,86395);assert.equal(fixes.at(-1).t,86415);
  assert.equal(fixes[0].alt,400);assert.equal(fixes.at(-1).alt,460);
  assert.equal(fixes[0].lat,1000/60000);
  assert.ok(fixes.every(p=>Number.isFinite(p.vario)&&Number.isFinite(p.speed)));
});
test('interpolation and endpoints',()=>{
  assert.equal(sample(fixes,fixes[0].t+.5).alt,401.5);
  assert.equal(sample(fixes,0).alt,400);assert.equal(sample(fixes,999999).alt,460);
});
test('sink is blue; lift red; neutral green',()=>{
  assert.deepEqual(varioColor(-5),[38,112,255,255]);assert.deepEqual(varioColor(5),[255,57,54,255]);assert.deepEqual(varioColor(0),[83,225,177,255]);
});
test('invalid clocks, coordinates, void and duplicate GPS records are ignored',()=>{
  const a='B2359590001000N00001000EA0000000400';
  const b='B0000010001000N00001000EA0000000402';
  const f=parseIGC([a,a,a.replace('235959','256199'),a.replace('0001000N','9901000N'),a.replace('0001000N','0061000N'),b,b.replace('EA','EV')].join('\n'));
  assert.equal(f.length,2);assert.equal(f[1].t-f[0].t,2);assert.equal(f[0].vario,1);
  assert.throws(()=>parseIGC('not IGC'));
});
