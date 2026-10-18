import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {generateMountainFlight,encodeIGC} from '../input/generate-fixture.mjs';
const igc=await readFile(new URL('../input/track.igc',import.meta.url),'utf8');
const generated=generateMountainFlight();
assert.equal(encodeIGC(generated),igc,'Copied generator must reproduce the fixed input exactly; do not regenerate track.');
const fixes=igc.split('\n').filter(l=>l.startsWith('B')).map((line,i)=>({
  t:i,
  lat:Number(line.slice(7,9))+Number(line.slice(9,14))/60000,
  lon:Number(line.slice(15,18))+Number(line.slice(18,23))/60000,
  alt:Number(line.slice(30,35)),
  airHeading:generated[i].airHeading,
  airSpeed:generated[i].airSpeed,
}));
assert.equal(fixes.length,91);
assert.equal(fixes[60].airHeading-fixes[28].airHeading,720);
await writeFile(new URL('../data/flight.json',import.meta.url),JSON.stringify(fixes));
console.log('91 exact IGC fixes; 720° air-relative turn from 28 to 60 seconds.');
