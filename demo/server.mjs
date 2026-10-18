import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('./',import.meta.url));
const types = {'.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.igc':'text/plain', '.webm':'video/webm', '.png':'image/png'};
export function createDemoServer() {
  return http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url,'http://demo');
      let name = decodeURIComponent(url.pathname);
      if (name === '/') name = '/index.html';
      if (name.startsWith('/demo/')) name = '/public'+name;
      if (!['/index.html','/demo.js','/demo.css','/dist/player.js'].includes(name) && !name.startsWith('/public/demo/')) { res.writeHead(404).end(); return; }
      const file = name === '/dist/player.js'
        ? fileURLToPath(new URL('../dist/player.js',import.meta.url))
        : path.resolve(root,'.'+name);
      const allowed = ['/index.html','/demo.js','/demo.css','/dist/player.js'].includes(name) || file.startsWith(path.join(root,'public','demo')+path.sep);
      if (!allowed || !(await stat(file)).isFile()) throw new Error('Not a file');
      const body = await readFile(file);
      const headers = {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
      const match = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (match) {
        const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : body.length-1, body.length-1);
        if (start > end || start >= body.length) {res.writeHead(416,{'Content-Range':`bytes */${body.length}`}).end();return;}
        res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${body.length}`,'Content-Length':end-start+1});
        res.end(body.subarray(start,end+1));
      } else { res.writeHead(200,{...headers,'Content-Length':body.length}); res.end(body); }
    } catch { res.writeHead(404).end('Not found'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 5173);
  createDemoServer().listen(port,'0.0.0.0',()=>console.log(`Demo listening on 0.0.0.0:${port}. Open http://<LAN-IP>:${port}/`));
}
