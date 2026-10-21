import {createPlayer} from '/dist/player.js';

const track = await (await fetch('/fixtures/regression/track.igc')).text();
const options = [{id: 'economy', label: 'Data saver'}, {id: 'detail', label: 'Fine view'}];
const manifest = () => ({version: 2, track: {igc: track, startUtc: '2030-01-01T23:59:55Z'},
  qualities: {options, default: 'economy', fallback: ['economy', 'detail']},
  clips: [{startUtc: '2030-01-01T23:59:55Z', durationSeconds: 5, sources: {
    economy: {url: '/quality/first?sig=%7Bx%7D&a=a+b', type: 'video/webm', mediaStartSeconds: 2},
    detail: {url: '/quality/cdn/other?sig=arbitrary', type: 'video/mp4', mediaStartSeconds: 7},
  }}, {startUtc: '2030-01-02T00:00:03Z', durationSeconds: 5, sources: {
    economy: {url: '/quality/first', type: 'video/webm', mediaStartSeconds: 2},
  }}, {startUtc: '2030-01-02T00:00:10Z', durationSeconds: 5, sources: {
    economy: {url: '/quality/first', type: 'video/webm', mediaStartSeconds: 2},
    detail: {url: '/quality/cdn/other', type: 'video/mp4', mediaStartSeconds: 7},
  }}]});
const events = [], released = [], owned = new Set();
const players = ['first', 'second'].map(id => createPlayer(document.getElementById(id), {sourceTimeouts: {resolveMs: 500, readyMs: 1800}}));
for (const [index, player] of players.entries()) {
  for (const type of ['qualitychange', 'qualitycatalogue', 'mediaerror', 'load']) player.on(type, event => {
    if (type === 'qualitychange' && JSON.stringify(player.state.quality) !== JSON.stringify(event.detail.quality)) throw new Error('Quality event and snapshot differ');
    events.push({index, type, ...event.detail});
  });
}
const catalogue = revision => ({revision, options, default: 'economy', fallback: ['economy', 'detail']});
async function blobSource(request) {
  const response = await fetch(request.quality === 'economy' ? '/quality/first' : '/quality/cdn/other');
  const url = URL.createObjectURL(await response.blob());
  owned.add(url);
  return {status: 'source', source: {quality: request.quality, url, mediaStartSeconds: request.quality === 'economy' ? 2 : 7,
    release: () => {owned.delete(url); released.push({request: request.request, url}); URL.revokeObjectURL(url);}}};
}
window.qa = {players, createPlayer, manifest, catalogue, blobSource, events, released, owned};
await Promise.all(players.map(p => p.load(manifest(), {baseUrl: location.href})));
window.qa.ready = true;
