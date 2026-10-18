import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHeading, headingDelta, smoothHeading} from './heading.js';
import {sample} from './flight.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('shortest heading delta handles wrap, negative and large continuous angles', () => {
  for (const [from, to, expected] of [[359,1,2],[1,359,-2],[705,.5,15.5],[1040,325,5],[-1040,35,-5],[0,180,-180],[180,0,-180]]) {
    for (const turns of [-10000,-3,0,3,10000]) {
      near(headingDelta(from + turns * 360, to), expected);
      near(headingDelta(from, to + turns * 360), expected);
    }
  }
  near(normalizeHeading(-721),359);
  near(normalizeHeading(3600001),1);
});

test('camera follows multiple clockwise and counterclockwise rotations without reversal', () => {
  const dt = 1 / 30, rate = 22.5;
  for (const direction of [1,-1]) {
    for (const start of [325,-3600325,3600325]) {
      let heading = start;
      for (let frame=1;frame<=16*30*8;frame++) {
        const desired = start + direction * rate * frame * dt;
        const next = smoothHeading(heading, normalizeHeading(desired), dt);
        const step = (next - heading) * direction;
        assert.ok(step >= 0 && step <= rate * dt + 1e-8, `Camera reversed or spun at frame ${frame}: ${step}`);
        assert.ok(Math.abs(desired - next) < 16, 'Camera stays within smoothing lag, not a full revolution behind');
        heading = next;
      }
    }
  }
});

test('sampling interpolates shortest arcs even with unwrapped input headings', () => {
  for (const [a,b,expected] of [[359,1,0],[1,359,0],[1040,325,322.5],[-1040,35,37.5]]) {
    const fixes = [{t:0,heading:a},{t:1,heading:b}].map(p=>({...p,lat:0,lon:0,alt:100,vario:0,speed:10}));
    near(sample(fixes,.5).heading,expected);
  }
});
