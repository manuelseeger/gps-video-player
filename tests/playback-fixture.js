import {createDeliveries, parseCatalogue, staticResolver} from '../src/sources.js';

export const flush = () => new Promise(resolve => setImmediate(resolve));

export function fixedSession(clips, overrides = {}) {
  const deliveries = createDeliveries();
  const input = {revision: 1, options: [{id: 'original', label: 'Original'}], default: 'original', fallback: []};
  const parse = value => parseCatalogue(value, {clipCount: clips.length, deliveries});
  return {load: 'test:1', catalogue: parse(input), parseCatalogue: parse,
    resolve: staticResolver(clips.map(c => ({original: {url: new URL(c.src, 'https://media.test').href, mediaStartSeconds: c.mediaOffsetSeconds ?? 0}}))),
    deliveries, timeouts: {resolveMs: 15000, readyMs: 20000}, ...overrides};
}

export function clock() {
  let time = 0, serial = 0;
  const jobs = new Map();
  return {now: () => time, timers: {
    setTimeout(fn, ms) { const id = ++serial; jobs.set(id, {at: time + ms, fn}); return id; },
    clearTimeout(id) { jobs.delete(id); },
  }, advance(ms) {
    time += ms;
    for (const [id, job] of [...jobs]) if (job.at <= time) { jobs.delete(id); job.fn(); }
  }};
}
