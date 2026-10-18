// Optional live check. Unit/browser smoke tests do not call public providers.
// Requires FFmpeg. --write stores a compact elevation reference for offline tests.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseIGC} from '../src/flight.js';
const dir=new URL('../demo/public/demo/',import.meta.url);
const text=await readFile(new URL('track.igc',dir),'utf8');
const fixes=parseIGC(text), zoom=14, n=2**zoom;
const cache=new Map();
const heights=[];
for (const p of fixes) {
  const x=(p.lon+180)/360*n, y=(1-Math.asinh(Math.tan(p.lat*Math.PI/180))/Math.PI)/2*n;
  const tx=Math.floor(x),ty=Math.floor(y),key=`${zoom}/${tx}/${ty}`;
  if(!cache.has(key)) {
    const url=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`;
    const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`${url}: ${response.status}`);
    const png=Buffer.from(await response.arrayBuffer());
    const decoded=spawnSync('ffmpeg',['-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:png,maxBuffer:2**20});
    if(decoded.status!==0 || decoded.stdout.length!==256*256*3)throw new Error(`DEM decode failed: ${decoded.stderr}`);
    cache.set(key,decoded.stdout);
  }
  const pixel=(Math.floor((y-ty)*256)*256+Math.floor((x-tx)*256))*3, rgb=cache.get(key);
  heights.push(Math.round((rgb[pixel]*256+rgb[pixel+1]+rgb[pixel+2]/256-32768)*10)/10);
}
const clearance=fixes.map((p,i)=>p.alt-heights[i]);
console.log(JSON.stringify({fixes:fixes.length,zoom,tiles:[...cache.keys()],groundMetres:[Math.min(...heights),Math.max(...heights)],clearanceMetres:[Math.min(...clearance),Math.max(...clearance)]},null,2));
if(Math.min(...clearance)<150)throw new Error('Synthetic flight must remain at least 150 m above sampled terrain');
if(process.argv.includes('--write'))await writeFile(new URL('../tests/fixtures/ground-reference.json',import.meta.url),JSON.stringify({
  description:'Nearest-pixel Terrarium elevations in metres MSL, one per IGC fix. For synthetic fixture validation only; not navigation data.',
  source:'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  attribution:'Produced using Copernicus data and information funded by the European Union — EU-DEM layers. AWS / Mapzen terrain tiles.',
  zoom,trackSha256:createHash('sha256').update(text).digest('hex'),heights,
},null,2)+'\n');
