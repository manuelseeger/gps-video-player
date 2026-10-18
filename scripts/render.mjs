import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,extname,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const ROOT=resolve(fileURLToPath(new URL('../',import.meta.url)));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const PREVIEW=process.argv.includes('--preview'),FPS=24,SECONDS=90;
await mkdir(join(ROOT,'output'),{recursive:true});await mkdir(join(ROOT,'previews'),{recursive:true});
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.geojson':'application/json'};
const server=createServer(async(req,res)=>{
 try{const path=resolve(ROOT,'.'+decodeURIComponent(req.url.split('?')[0]));if(!path.startsWith(ROOT+'/'))throw Error('Path');const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}
});
server.listen(0,'0.0.0.0');await once(server,'listening');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars']});
let encoder;
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
 page.on('pageerror',e=>console.error('PAGE ERROR',e));page.on('console',m=>{if(m.type()==='error')console.error('WEBGL',m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/render/index.html`);
 await page.waitForFunction(()=>window.sceneReady,null,{timeout:120000});
 if(await page.locator('body').innerText())throw Error('Visible text is not allowed in rendered frames');
 const times=PREVIEW?[0,12,24,28,32,36,40,44,48,52,56,60,66,75,89]:Array.from({length:FPS*SECONDS},(_,i)=>i/FPS);
 if(!PREVIEW){
  encoder=spawn('bash',[join(ROOT,'scripts/encode-vp8.sh')],{stdio:['pipe','ignore','inherit']});
  encoder.stdin.on('error',e=>console.error('Encoder input:',e.message));
 }
 const started=Date.now(),stats=[];
 for(let i=0;i<times.length;i++){
  if(Date.now()-started>20*60*1000)throw Error('Render time limit: 20 minutes');
  const t=times[i];const state=await page.evaluate(t=>window.renderFrame(t),t);
  const frame=await page.screenshot({type:'jpeg',quality:95,animations:'disabled'});
  if(PREVIEW){await writeFile(join(ROOT,`previews/frame-${String(t).padStart(2,'0')}.jpg`),frame);stats.push(state);}
  else{if(!encoder.stdin.write(frame))await once(encoder.stdin,'drain');if(i%240===0)console.log(`${i}/${times.length} frames; ${((Date.now()-started)/1000).toFixed(1)} s wall; flight ${t}s`);}
 }
 if(encoder){const done=once(encoder,'close');encoder.stdin.end();const [code]=await done;if(code!==0)throw Error(`ffmpeg exited ${code}`);}
 else await writeFile(join(ROOT,'previews/camera-samples.json'),JSON.stringify(stats,null,2));
 console.log(`Complete: ${times.length} frames in ${((Date.now()-started)/1000).toFixed(1)} seconds.`);
}finally{if(encoder&&encoder.exitCode===null)encoder.kill('SIGTERM');await browser.close();server.close();}
