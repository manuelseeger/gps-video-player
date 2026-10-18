import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createDemoServer as demoServer} from '../demo/server.mjs';

const files = new Map([
  ['/integration.html', ['integration.html', 'text/html']],
  ['/integration.js', ['integration.js', 'text/javascript']],
  ...['manifest.json', 'track.igc', 'demo.webm', 'terrain.png'].map((name, i) =>
    [`/fixtures/regression/${name}`, [`fixtures/regression/${name}`, ['application/json', 'text/plain', 'video/webm', 'image/png'][i]]]),
]);

export function createDemoServer() {
  const demo = demoServer();
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://test').pathname;
    if (pathname === '/redirect') {
      res.writeHead(302, {Location:'/fixtures/regression/manifest.json'}).end();
      return;
    }
    const file = files.get(pathname);
    if (!file) { demo.emit('request', req, res); return; }
    try {
      const body = await readFile(new URL(file[0], import.meta.url));
      const headers = {'Content-Type':file[1], 'Access-Control-Allow-Origin':'*', 'Accept-Ranges':'bytes', 'Cache-Control':'no-store'};
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
        if (start > end || start >= body.length) {
          res.writeHead(416, {'Content-Range':`bytes */${body.length}`}).end();
          return;
        }
        res.writeHead(206, {...headers, 'Content-Range':`bytes ${start}-${end}/${body.length}`, 'Content-Length':end-start+1});
        res.end(body.subarray(start, end+1));
      } else {
        res.writeHead(200, {...headers, 'Content-Length':body.length}).end(body);
      }
    } catch { res.writeHead(404).end('Not found'); }
  });
}
