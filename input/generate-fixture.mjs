// Deterministic synthetic fixtures. No recorded flights or personal metadata.
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const phases = [
  {name:'Straight glide', start:0, end:20, turn:0, speed:11, climb:-1.1},
  {name:'45-degree entry', start:20, end:28, turn:45/8, speed:10, climb:.4},
  {name:'Two thermal rotations', start:28, end:60, turn:22.5, speed:9.2, climb:2.1},
  {name:'40-degree right departure', start:60, end:68, turn:40/8, speed:10, climb:-.8},
  {name:'Straight glide', start:68, end:90, turn:0, speed:11.2, climb:-1.3},
];

export function generateMountainFlight() {
  // West of Dents de Lanfon, above the Planfait / Lake Annecy slopes, France.
  // This is an airborne excerpt, not a launch/landing or a navigation route.
  let lat=45.842, lon=6.245, alt=1900, heading=280, speed=11, climb=-1.1;
  const fixes=[];
  for (let t=0;t<=90;t++) {
    // Unwrapped airHeading and airSpeed describe the preceding interval.
    fixes.push({t:43200+t,lat,lon,alt,airHeading:heading,airSpeed:speed});
    if(t===90) break;
    const phase=phases.find(p=>t>=p.start && t<p.end) ?? phases.at(-1);
    // Exactly 22.5 degrees per second throughout [28,60): 720 degrees.
    // No roll ramps: each air-relative rotation takes exactly 16 seconds.
    // Separate 8-second entry/departure phases turn exactly +45/+40 degrees.
    // The two full circles preserve the thermal entry heading; departure is
    // 40 degrees to its right, with no left-turn reversal.
    heading+=phase.turn;
    speed+=(phase.speed+.25*Math.sin(t/13)-speed)*.3;
    climb+=(phase.climb+.15*Math.sin(t/17)-climb)*.3;
    // Mild fixed wind: 0.8 m/s east, 0.3 m/s north. 1-second integration.
    const north=speed*Math.cos(heading*Math.PI/180)+.3;
    const east=speed*Math.sin(heading*Math.PI/180)+.8;
    lat+=north/111195;
    lon+=east/(111195*Math.cos(lat*Math.PI/180));
    alt+=climb;
  }
  return fixes;
}

function coordinate(value, degrees) {
  const minutes=Math.round(Math.abs(value)*60000);
  return String(Math.floor(minutes/60000)).padStart(degrees,'0')+String(minutes%60000).padStart(5,'0');
}
export function encodeIGC(fixes, date='010730') {
  const rows=['AXXXSYNTHETIC',`HFDTE${date}`,'LXXXSYNTHETIC FLIGHT - NO RECORDED PILOT DATA','HFGTYGLIDERTYPE:SIMULATED PARAGLIDER'];
  for (const p of fixes) {
    const s=p.t%86400;
    const time=[Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join('');
    const altitude=String(Math.round(p.alt)).padStart(5,'0');
    rows.push(`B${time}${coordinate(p.lat,2)}${p.lat<0?'S':'N'}${coordinate(p.lon,3)}${p.lon<0?'W':'E'}A${altitude}${altitude}`);
  }
  return rows.join('\n')+'\n';
}

export function mountainManifest() {
  return {
    version:1,
    metadata:{title:'Synthetic flight · Lake Annecy',description:'90-second synthetic paragliding excerpt above Planfait, France: straight glides, a +45-degree entry turn (0:20–0:28), a +40-degree right departure turn (1:00–1:08, 5 degrees/second), leaving 40 degrees right of the thermal entry heading, sink, lift and exactly two 16-second air-relative thermal rotations in one 32-second section (0:28–1:00), at 22.5 degrees/second without roll ramps. The synchronized 90-second video is a generated test pattern, not flight-camera footage.',timeZone:'Europe/Paris',synthetic:true},
    track:{url:'./track.igc',startUtc:'2030-07-01T12:00:00Z'},
    clips:[{url:'./demo.webm',startUtc:'2030-07-01T12:00:00Z',durationSeconds:90,mediaOffsetSeconds:0}],
    map:{
      style:{version:8,sources:{
        imagery:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery: <a href="https://goto.arcgisonline.com/maps/World_Imagery">Esri, Vantor, Earthstar Geographics, and the GIS User Community</a>'},
        dem:{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],tileSize:256,maxzoom:15,encoding:'terrarium',attribution:'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS / Mapzen</a> · Produced using Copernicus data and information funded by the European Union — EU-DEM layers; <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">other terrain sources</a>'},
      },layers:[{id:'imagery',type:'raster',source:'imagery',paint:{'raster-fade-duration':0}}]},
      terrain:{source:'dem',exaggeration:1},
    },
  };
}

export async function generateFixtures() {
  const dir=new URL('../demo/public/demo/',import.meta.url), regression=new URL('../tests/fixtures/regression/',import.meta.url);
  await mkdir(regression,{recursive:true});
  // Keep the tiny midnight fixture byte-for-byte: its unusual coordinates and
  // altitudes are intentional regression inputs, not the public flight demo.
  const rows=['AXXXSYNTHETIC','HFDTE010130'];
  for(let i=0;i<=20;i++) {
    const seconds=(86395+i)%86400;
    const time=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join('');
    rows.push(`B${time}000${String(1000+i*12).padStart(4,'0')}N0000${String(1000+i*18).padStart(4,'0')}EA00000${String(400+i*3).padStart(5,'0')}`);
  }
  const manifest={version:1,metadata:{title:'Synthetic midnight flight',description:'Artificial flight and test video',timeZone:'UTC'},track:{url:'./track.igc',startUtc:'2030-01-01T23:59:55Z'},clips:[{url:'./demo.webm',startUtc:'2030-01-01T23:59:55Z',durationSeconds:4,mediaOffsetSeconds:1},{url:'./demo.webm',startUtc:'2030-01-02T00:00:01Z',durationSeconds:4,mediaOffsetSeconds:3}],map:{style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#15313c'}}]}}};
  await Promise.all([
    writeFile(new URL('track.igc',regression),rows.join('\n')+'\n'),
    writeFile(new URL('manifest.json',regression),JSON.stringify(manifest,null,2)+'\n'),
    writeFile(new URL('track.igc',dir),encodeIGC(generateMountainFlight())),
    writeFile(new URL('manifest.json',dir),JSON.stringify(mountainManifest(),null,2)+'\n'),
  ]);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await generateFixtures();
