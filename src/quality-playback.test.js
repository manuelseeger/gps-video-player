import test from 'node:test';
import assert from 'node:assert/strict';
import {Playback} from './playback.js';
import {Timeline} from './timeline.js';
import {createDeliveries, parseCatalogue, staticResolver} from './sources.js';
import {clock, flush} from '../tests/playback-fixture.js';

class Media extends EventTarget {
  constructor() {
    super(); Object.assign(this, {currentTime: 0, duration: 30, readyState: 0, videoWidth: 640, paused: true, seeking: false, hidden: true, playCalls: 0});
  }
  emit(name) { this.dispatchEvent(new Event(name)); }
  load() {}
  removeAttribute() { this.src = ''; }
  pause() { this.paused = true; this.emit('pause'); }
  play() {
    ++this.playCalls;
    if (this.start) return this.start();
    this.paused = false; this.emit('playing'); return Promise.resolve();
  }
  ready() { this.readyState = 4; this.emit('loadedmetadata'); this.emit('canplay'); }
}
const catalogue = () => ({revision: 1, options: [{id: 'economy', label: 'Data saver'}, {id: 'detail', label: 'Fine view'}], default: 'economy', fallback: ['economy', 'detail']});
function setup({input = catalogue(), resolve, clips, adapters = [], load = 'first:1', timeouts = {resolveMs: 15, readyMs: 20}} = {}) {
  const timeline = new Timeline({clips: clips ?? [
    {startUtcSeconds: 100, durationSeconds: 10}, {startUtcSeconds: 120, durationSeconds: 10},
  ]}, 95, 140);
  const time = clock(), media = [], mounted = new Set(), released = [], requests = [], events = [], errors = [];
  const deliveries = createDeliveries(adapters);
  const parse = value => parseCatalogue(value, {clipCount: timeline.clips.length, deliveries});
  const session = {load, catalogue: parse(input), parseCatalogue: parse, deliveries, timeouts,
    resolve: request => {
      requests.push(request);
      return resolve ? resolve(request, released) : {status: 'source', source: {quality: request.quality,
        url: `https://media.test/${request.quality}?signature=${requests.length}`, mediaStartSeconds: request.quality === 'economy' ? 2 : 7,
        release: () => released.push(request.request)}};
    }};
  let p;
  p = new Playback(timeline, {session, timers: time.timers, now: time.now,
    createMedia: () => { const value = new Media(); media.push(value); mounted.add(value); return value; },
    removeMedia: value => mounted.delete(value),
    onQuality: value => {
      assert.deepEqual(value.quality, p.state.quality, 'Event snapshot is the committed public snapshot');
      events.push(value);
    }, onError: (message, detail) => errors.push({message, ...detail}),
  });
  const ready = async () => { await flush(); media.at(-1).ready(); await flush(); };
  const prime = async (elapsed = 3.25) => { p.seek(elapsed); await ready(); };
  return {p, media, mounted, released, requests, events, errors, ready, prime, advance: async ms => {time.advance(ms); p.tick(); await flush();}};
}

test('1 static arbitrary sources use one acquisition contract and no discovery', async () => {
  const resolve = staticResolver([{economy: {url: 'https://one.test/opaque?a=a+b', mediaStartSeconds: 2}, detail: {url: 'https://two.test/no-extension?sig=%7Bx%7D', mediaStartSeconds: 7}}]);
  const s = setup({resolve}); await s.prime();
  const ack = s.p.selectQuality('detail'); await s.ready();
  assert.equal((await ack).status, 'applied');
  assert.equal(s.media.at(-1).src, 'https://two.test/no-extension?sig=%7Bx%7D');
  assert.equal(s.media.at(-1).currentTime, 10.25);
  assert.equal(s.p.state.elapsed, 3.25);
  assert.equal(s.mounted.size, 1);
  assert.equal(Object.hasOwn(s.p.state, 'src'), false);
  s.p.destroy();
});

test('2 an expired URL stops at the same position and Play resolves a fresh use', async () => {
  const s = setup(); await s.prime();
  s.p.play(); await flush();
  s.media[0].currentTime = 6.5; s.p.tick();
  s.media[0].emit('error'); await flush();
  assert.equal(s.p.state.elapsed, 4.5);
  assert.equal(s.p.state.quality.active, null);
  assert.equal(s.p.phase, 'error');
  s.p.play(); await s.ready();
  assert.equal(s.media[1].src, 'https://media.test/economy?signature=2');
  assert.equal(s.media[1].currentTime, 6.5);
  assert.equal(s.requests[1].localTime, 4.5);
  assert.notEqual(s.requests[0].request, s.requests[1].request);
  assert.equal(s.p.state.load, 'first:1');
  assert.equal(s.p.phase, 'playing');
  assert.deepEqual(s.released, [s.requests[0].request]);
  s.p.destroy(); assert.equal(s.released.length, 2);
});

test('3 paused and playing switches preserve offset mapping, UTC, settings and frozen time', async () => {
  for (const playing of [false, true]) {
    const s = setup(); await s.prime();
    s.p.setNudge(1.5); s.p.setRate(2); s.p.setAudio(.3, true);
    if (playing) { s.p.play(); await flush(); }
    assert.equal(s.media[0].currentTime, 5.25);
    const ack = s.p.selectQuality('detail'); await flush();
    await s.advance(5);
    assert.equal(s.p.elapsed, 3.25); assert.equal(s.p.state.utc, 104.75);
    assert.equal(s.released.length, 0); assert.equal(s.media[0].paused, true);
    s.media[1].ready(); await flush();
    const result = await ack;
    assert.deepEqual([result.status, result.active, result.playing], ['applied', 'detail', playing]);
    assert.equal(s.media[1].currentTime, 10.25);
    assert.equal(s.p.state.utc, 104.75); assert.equal(s.p.nudge, 1.5);
    assert.deepEqual([s.media[1].playbackRate, s.media[1].volume, s.media[1].muted], [2, .3, true]);
    s.p.destroy();
  }
});

test('4 gaps defer without acquisition and fallback does not overwrite preference', async () => {
  const input = catalogue(); input.availability = [{detail: 'unavailable'}, {detail: 'available'}];
  const s = setup({input}); s.p.seek(-3);
  const deferred = await s.p.selectQuality('detail');
  assert.deepEqual([deferred.status, deferred.reason, deferred.request], ['deferred', 'gap', null]);
  assert.equal(s.requests.length, 0);
  await s.prime();
  assert.deepEqual([s.p.quality.requested, s.p.quality.active, s.p.quality.outcome.outcome, s.p.quality.outcome.reason], ['detail', 'economy', 'fallback', 'unavailable']);
  s.p.seek(15); const gap = await s.p.selectQuality('detail');
  assert.equal(gap.status, 'deferred'); assert.equal(s.requests.length, 1);
  s.p.seek(23.25); await s.ready();
  assert.deepEqual([s.p.quality.requested, s.p.quality.active], ['detail', 'detail']);
  assert.equal(s.requests[1].clip.index, 1); assert.equal(s.requests[1].localTime, 3.25);
  assert.equal(s.media.at(-1).currentTime, 10.25);
  s.p.destroy();
});

test('5 rapid choices, duplicate calls, seek, pause and destroy settle once and release late uses', async () => {
  const pending = [];
  const s = setup({resolve: request => new Promise(done => pending.push({request, done}))});
  s.p.seek(1); await flush();
  const first = s.p.selectQuality('detail');
  const duplicate = s.p.selectQuality('detail'); await flush();
  assert.equal(pending.length, 2);
  s.p.seek(4.25); s.p.pause(); await flush();
  assert.equal((await first).status, 'cancelled'); assert.deepEqual(await duplicate, await first);
  assert.equal((await first).reason, 'superseded');
  assert.deepEqual(pending.map(v => v.request.localTime), [1, 1, 4.25]);
  for (const item of pending.slice(0, 2)) {
    assert.equal(item.request.signal.aborted, true);
    item.done({status: 'source', source: {quality: item.request.quality, url: 'https://media.test/late', release: () => s.released.push(item.request.request)}});
  }
  await flush(); assert.equal(s.media.length, 0); assert.equal(s.released.length, 2);
  pending[2].done({status: 'source', source: {quality: 'detail', url: 'https://media.test/current', release: () => s.released.push(pending[2].request.request)}});
  await s.ready(); assert.equal(s.p.phase, 'paused'); assert.equal(s.p.elapsed, 4.25);
  const last = s.p.selectQuality('economy'); await flush();
  s.p.destroy('load'); assert.equal((await last).reason, 'load');
  const late = pending[3]; late.done({status: 'source', source: {quality: 'economy', url: 'https://media.test/last', release: () => s.released.push(late.request.request)}});
  await flush();
  assert.equal(new Set(s.released).size, 4); assert.equal(s.released.length, 4); assert.equal(s.mounted.size, 0);
  const terminals = s.events.filter(e => ['applied', 'failed', 'cancelled', 'deferred'].includes(e.status));
  assert.equal(new Set(terminals.map(e => e.transition)).size, terminals.length);
});

test('5 selecting the active choice cancels another pending choice without releasing the retained use', async () => {
  const s = setup(); await s.prime(); s.p.play(); await flush();
  const resolve = s.p.session.resolve;
  s.p.session.resolve = () => new Promise(() => {});
  const pending = s.p.selectQuality('detail'); await flush();
  const current = await s.p.selectQuality('economy');
  assert.deepEqual([(await pending).status, (await pending).reason, current.status, current.playing], ['cancelled', 'superseded', 'applied', true]);
  assert.equal(s.requests.length, 1); assert.equal(s.released.length, 0);
  assert.equal(s.p.active.controller.signal.aborted, false); assert.equal(s.p.phase, 'playing');
  s.p.session.resolve = resolve; s.p.destroy();
});

test('5 successful candidates release the previous use only after play acknowledgement', async () => {
  const s = setup(); await s.prime(); s.p.play(); await flush();
  const ack = s.p.selectQuality('detail'); await flush();
  let start;
  s.media[1].start = () => new Promise(done => start = () => {s.media[1].paused = false; done();});
  s.media[1].ready(); await flush();
  assert.equal(s.p.quality.active, 'economy'); assert.equal(s.released.length, 0);
  start(); await flush();
  assert.equal((await ack).active, 'detail'); assert.equal(s.released.length, 1);
  assert.equal(s.mounted.size, 1); s.p.destroy();
});

test('5 advancing media during delayed play acknowledgement keeps the mapped candidate and frozen position', async () => {
  for (const emitPlaying of [false, true]) {
    const s = setup({timeouts: {resolveMs: 1000, readyMs: 1000}}); await s.prime();
    s.p.setNudge(1.5); s.p.setRate(2); s.p.play(); await flush();
    const ack = s.p.selectQuality('detail'); await flush();
    const candidate = s.media[1];
    let acknowledge;
    candidate.start = () => { candidate.paused = false; return new Promise(done => acknowledge = done); };
    candidate.ready(); await flush();
    candidate.currentTime = 10.65;
    if (emitPlaying) candidate.emit('playing');
    await s.advance(200);
    assert.deepEqual([s.p.quality.active, s.p.quality.pending, s.p.elapsed, s.p.state.utc], ['economy', 'detail', 3.25, 104.75]);
    assert.equal(s.released.length, 0);
    acknowledge(); await flush();
    const result = await ack;
    assert.deepEqual([result.status, result.active, result.playing, result.reason], ['applied', 'detail', true, null]);
    assert.equal(s.p.elapsed, 3.25);
    assert.equal(s.errors.length, 0);
    assert.deepEqual(s.released, [s.requests[0].request]);
    s.p.tick();
    assert.ok(Math.abs(s.p.elapsed - 3.65) < 1e-9);
    s.p.destroy();
  }
});

test('5 a paused high-resolution choice resumes when playback advances before acknowledgement', async () => {
  const s = setup(); await s.prime();
  const selection = s.p.selectQuality('detail'); await s.ready(); await selection;
  const candidate = s.media[1]; candidate.videoWidth = 1920;
  let acknowledge;
  candidate.start = () => { candidate.paused = false; return new Promise(done => acknowledge = done); };
  s.p.play(); await flush();
  candidate.currentTime = 10.45;
  acknowledge(); await flush();
  assert.deepEqual([s.p.quality.active, s.p.quality.pending, s.p.phase, s.p.quality.outcome.status], ['detail', null, 'playing', 'applied']);
  assert.equal(s.p.elapsed, 3.25);
  assert.equal(s.errors.length, 0);
  s.p.destroy();
});

test('5 an incorrect initial seek still fails mapping before playback starts', async () => {
  const s = setup(); await s.prime();
  const ack = s.p.selectQuality('detail'); await flush();
  Object.defineProperty(s.media[1], 'currentTime', {get: () => 0, set() {}});
  s.media[1].ready(); await flush();
  const result = await ack;
  assert.deepEqual([result.status, result.active, result.reason], ['failed', 'economy', 'mapping-failed']);
  assert.equal(s.media[1].playCalls, 0);
  assert.equal(s.p.elapsed, 3.25);
  s.p.destroy();
});

test('5 delayed play acknowledgement remains bounded and cannot revive a timed-out candidate', async () => {
  const s = setup(); await s.prime(); s.p.play(); await flush();
  const ack = s.p.selectQuality('detail'); await flush();
  const candidate = s.media[1];
  let acknowledge;
  candidate.start = () => { candidate.paused = false; return new Promise(done => acknowledge = done); };
  candidate.ready(); await flush(); candidate.currentTime = 10.45;
  await s.advance(21);
  const result = await ack;
  assert.deepEqual([result.status, result.active, result.reason], ['failed', 'economy', 'timeout']);
  acknowledge(); await flush();
  assert.deepEqual([s.p.quality.active, s.p.phase, candidate.paused, s.p.elapsed], ['economy', 'playing', true, 3.25]);
  s.p.destroy();
});

test('6 a removed pending choice cancels and a removed active lease stays until replacement commits', async () => {
  let pending;
  const s = setup(); await s.prime();
  const oldResolve = s.p.session.resolve;
  s.p.session.resolve = request => request.quality === 'detail' ? new Promise(done => pending = done) : oldResolve(request);
  const choice = s.p.selectQuality('detail'); await flush();
  const next = {revision: 2, options: [{id: 'economy', label: 'Saver'}], default: 'economy', fallback: []};
  assert.deepEqual(s.p.updateCatalogue('other:1', next), {status: 'rejected', reason: 'stale-load', message: 'The flight load is no longer current.'});
  assert.equal(s.p.updateCatalogue('first:1', next).status, 'updated');
  assert.equal((await choice).reason, 'removed');
  assert.equal(s.p.quality.requested, 'economy'); assert.equal(s.released.length, 0);
  await s.ready();
  pending({status: 'source', source: {quality: 'detail', url: 'https://media.test/obsolete', release: () => s.released.push('late')}});
  await flush(); assert.equal(s.released.length, 2);
  const economy = s.p.active;
  const detailOnly = {revision: 3, options: [{id: 'detail', label: 'Detail'}], default: 'detail', fallback: []};
  s.p.session.resolve = oldResolve;
  assert.equal(s.p.updateCatalogue('first:1', detailOnly).status, 'updated'); await flush();
  assert.equal(economy.disposed, false); assert.equal(s.p.quality.active, 'economy');
  await s.ready();
  assert.equal(economy.disposed, true); assert.equal(s.p.quality.active, 'detail');
  assert.equal(s.p.quality.outcome.reason, 'removed');
  assert.equal(s.p.updateCatalogue('first:1', detailOnly).reason, 'stale-revision');
  s.p.destroy();
});

test('6 removed active sources cannot be restored and unsupported defaults use only declared fallback', async () => {
  const s = setup(); await s.prime();
  const next = {revision: 2, options: [{id: 'auto', label: 'Auto', mode: 'auto'}, {id: 'detail', label: 'Detail'}], default: 'auto', fallback: []};
  s.p.updateCatalogue('first:1', next); await flush();
  assert.equal(s.p.phase, 'error'); assert.equal(s.p.elapsed, 3.25);
  assert.deepEqual([s.p.quality.requested, s.p.quality.active, s.p.quality.outcome.reason], ['auto', null, 'unsupported']);
  assert.equal(s.requests.length, 1); assert.equal(s.released.length, 1);
  s.p.destroy();
});

test('7 requested failure restores the previous source before declared fallback', async () => {
  const s = setup(); await s.prime();
  s.p.session.resolve = () => ({status: 'failed', message: 'The service is busy.', retryable: true});
  const ack = await s.p.selectQuality('detail');
  assert.deepEqual([ack.status, ack.active, ack.reason, ack.message], ['failed', 'economy', 'resolver-failed', 'The service is busy.']);
  assert.equal(s.p.quality.requested, 'detail'); assert.equal(s.p.phase, 'paused');
  assert.equal(s.media.length, 1); assert.equal(s.released.length, 0);
  assert.equal(s.p.elapsed, 3.25); assert.equal(s.media[0].currentTime, 5.25);
  assert.equal(s.events.at(-2).status, 'candidate');
  assert.equal(s.events.at(-2).request, 'first:1:t2:r1');
  assert.equal(s.errors.length, 0);
  s.p.destroy();
});

test('7 failed play acknowledgement retains ownership and restores before releasing the previous use', async () => {
  const s = setup(); await s.prime(); s.p.play(); await flush();
  const ack = s.p.selectQuality('detail'); await flush();
  let reject;
  s.media[1].start = () => new Promise((_, done) => reject = done);
  s.media[1].ready(); await flush();
  assert.equal(s.released.length, 0); assert.equal(s.mounted.size, 2); assert.equal(s.p.quality.pending, 'detail');
  reject(new Error('private server response')); await flush();
  assert.deepEqual([(await ack).status, (await ack).active], ['failed', 'economy']);
  assert.equal(s.p.phase, 'playing'); assert.equal(s.mounted.size, 1);
  assert.deepEqual(s.released, [s.requests[1].request]);
  assert.equal(s.media[0].src, 'https://media.test/economy?signature=1');
  s.p.destroy();
});

test('7 paused resolution and readiness waits are bounded and each fallback is attempted once', async () => {
  const resolving = setup({resolve: () => new Promise(() => {})}); resolving.p.seek(3.25); await flush();
  await resolving.advance(16); assert.equal(resolving.requests.length, 2);
  await resolving.advance(16);
  assert.deepEqual([resolving.p.phase, resolving.p.elapsed, resolving.p.quality.outcome.reason], ['error', 3.25, 'timeout']);
  assert.equal(resolving.p.playing, false); assert.equal(resolving.errors.length, 0);
  assert.equal(resolving.p.error.kind, 'source');
  const ready = setup(); ready.p.seek(3.25); await flush();
  await ready.advance(21); await ready.advance(21);
  assert.equal(ready.p.phase, 'error'); assert.equal(ready.requests.length, 2);
  assert.equal(ready.released.length, 2); assert.equal(ready.mounted.size, 0);
  assert.equal(ready.errors.length, 2); assert.equal(ready.p.error.kind, 'media');
  resolving.p.destroy(); ready.p.destroy();
});

test('7 decode, complete interval and unsupported failures cannot report false applied', async () => {
  for (const mode of ['decode', 'interval', 'unsupported']) {
    const s = setup({input: {...catalogue(), fallback: []}});
    if (mode === 'unsupported') s.p.session.resolve = () => ({status: 'unsupported'});
    s.p.seek(3.25); await flush();
    if (mode !== 'unsupported') {
      if (mode === 'decode') s.media[0].videoWidth = 0;
      else s.media[0].duration = 5;
      s.media[0].ready(); await flush();
    }
    assert.deepEqual([s.p.phase, s.p.elapsed, s.p.quality.active, s.p.quality.outcome.status], ['error', 3.25, null, 'failed']);
    assert.equal(s.p.quality.outcome.reason, mode === 'decode' ? 'media-failed' : mode === 'interval' ? 'mapping-failed' : 'unsupported');
    s.p.destroy();
  }
});

test('7 autoplay rejection commits a usable paused frame with blocked status, not resumed playback', async () => {
  const s = setup(); await s.prime(); s.p.play(); await flush();
  const ack = s.p.selectQuality('detail'); await flush();
  s.media[1].start = () => Promise.reject(Object.assign(new Error('private'), {name: 'NotAllowedError'}));
  s.media[1].ready(); await flush();
  assert.deepEqual([(await ack).status, (await ack).playing, (await ack).reason], ['applied', false, 'autoplay-blocked']);
  assert.equal(s.p.phase, 'paused'); assert.equal(s.p.playing, false);
  assert.equal(s.p.error.message, 'Playback was blocked. Press Play to continue.');
  s.media[1].start = null; s.p.play(); await flush();
  assert.equal(s.p.phase, 'playing'); assert.equal(s.requests.length, 2);
  s.p.destroy();
});

test('successful Play clears an earlier autoplay rejection in the outcome and quality event', async () => {
  const s = setup(); await s.prime();
  s.media[0].start = () => Promise.reject(Object.assign(new Error('Blocked'), {name: 'NotAllowedError'}));
  for (let attempt = 0; attempt < 2; ++attempt) {
    s.p.play(); await flush();
    assert.deepEqual([s.p.phase, s.p.quality.outcome.reason, s.p.quality.outcome.playing], ['paused', 'autoplay-blocked', false]);
  }
  s.media[0].start = null;
  s.p.play(); await flush();
  assert.deepEqual([s.p.phase, s.p.error, s.p.quality.outcome.status, s.p.quality.outcome.reason, s.p.quality.outcome.playing],
    ['playing', null, 'applied', null, true]);
  assert.deepEqual([s.events.at(-1).status, s.events.at(-1).reason, s.events.at(-1).quality.outcome.playing], ['applied', null, true]);
  assert.equal(s.requests.length, 1);
  s.p.destroy();
});

test('restored failures resume the healthy source without retrying the failed preference', async () => {
  const s = setup(); await s.prime(); s.p.play(); await flush();
  s.p.session.resolve = request => {
    s.requests.push(request);
    return {status: 'failed', message: 'Busy.', retryable: true};
  };
  const result = await s.p.selectQuality('detail');
  assert.deepEqual([result.status, result.active, result.reason], ['failed', 'economy', 'resolver-failed']);
  assert.equal(s.p.error, null);
  s.p.pause(); s.p.play(); await flush();
  assert.deepEqual([s.p.phase, s.p.quality.active, s.media[0].paused, s.requests.length], ['playing', 'economy', false, 2]);
  assert.deepEqual([s.p.quality.outcome.outcome, s.p.quality.outcome.reason], ['fallback', 'resolver-failed']);
  s.p.destroy();
});

test('ordinary resume retains the known unavailable fallback reason', async () => {
  const input = catalogue(); input.default = 'detail'; input.availability = [{detail: 'unavailable'}];
  const s = setup({input}); await s.prime();
  s.p.play(); await flush(); s.p.pause(); s.p.play(); await flush();
  assert.deepEqual([s.p.quality.requested, s.p.quality.active, s.p.quality.outcome.reason, s.requests.length], ['detail', 'economy', 'unavailable', 1]);
  s.p.destroy();
});

test('a revision cancels the old request and restores a still-supported active source on new failure', async () => {
  const s = setup(); await s.prime(); s.p.play(); await flush();
  const healthy = s.p.active;
  let late;
  s.p.session.resolve = request => {
    s.requests.push(request);
    return request.revision === 1 ? new Promise(done => late = done) : {status: 'failed', message: 'Busy.', retryable: true};
  };
  const ack = s.p.selectQuality('detail'); await flush();
  assert.deepEqual(s.p.updateCatalogue('first:1', {...catalogue(), revision: 2}), {status: 'updated'});
  const cancelled = await ack;
  assert.deepEqual([cancelled.status, cancelled.reason, cancelled.revision], ['cancelled', 'superseded', 1]);
  late({status: 'failed', message: 'Busy.', retryable: true}); await flush();
  assert.deepEqual([s.p.phase, s.p.quality.active, healthy.disposed, s.requests.length], ['playing', 'economy', false, 3]);
  assert.deepEqual([s.p.quality.outcome.status, s.p.quality.outcome.revision, s.p.quality.outcome.reason], ['failed', 2, 'resolver-failed']);
  s.p.destroy();
});

test('same-clip seeks reuse the healthy source without acquisition or release', async () => {
  const s = setup(); await s.prime();
  for (const elapsed of [2, 3, 4]) { s.p.seek(elapsed); await flush(); }
  assert.deepEqual([s.p.elapsed, s.p.media.currentTime, s.requests.length, s.media.length, s.released.length], [4, 6, 1, 1, 0]);
  assert.deepEqual([s.p.phase, s.p.quality.active], ['paused', 'economy']);
  s.p.destroy();
});

test('a same-clip seek resolves a differing preference but restores the old source at the new position', async () => {
  const s = setup(); await s.prime();
  s.p.session.resolve = request => {
    s.requests.push(request);
    return {status: 'failed', message: 'Busy.', retryable: true};
  };
  await s.p.selectQuality('detail');
  s.p.seek(8); await flush();
  assert.deepEqual([s.p.elapsed, s.p.media.currentTime, s.requests.length, s.media.length, s.released.length], [8, 10, 3, 1, 0]);
  assert.deepEqual([s.p.phase, s.p.quality.requested, s.p.quality.active, s.p.quality.outcome.status], ['paused', 'detail', 'economy', 'failed']);
  s.p.destroy();
});

test('failed same-clip reuse acquires a fresh source at the latest position', async () => {
  const s = setup(); await s.prime();
  s.media[0].videoWidth = 0;
  s.p.seek(8); await s.ready();
  assert.deepEqual([s.p.elapsed, s.p.media.currentTime, s.requests.length, s.released.length], [8, 10, 2, 1]);
  assert.deepEqual([s.p.phase, s.p.quality.active], ['paused', 'economy']);
  s.p.destroy();
});

test('a failed reuse keeps ownership so a recovered source can restore after fresh resolution fails', async () => {
  const s = setup(); await s.prime();
  const healthy = s.p.active; let mediaTime = healthy.media.currentTime, seeks = 0;
  Object.defineProperty(healthy.media, 'currentTime', {get: () => mediaTime, set: value => {
    if (++seeks === 1) throw new Error('Temporary seek failure');
    mediaTime = value;
  }});
  s.p.session.resolve = () => ({status: 'failed', message: 'Busy.', retryable: true});
  s.p.seek(8); await flush();
  assert.deepEqual([s.p.phase, s.p.quality.active, s.p.media.currentTime, healthy.disposed, s.released.length], ['paused', 'economy', 10, false, 0]);
  assert.deepEqual([s.p.quality.outcome.status, s.p.quality.outcome.reason], ['failed', 'resolver-failed']);
  s.p.destroy();
});

test('an incomplete full media interval is rejected at both early and late seek targets', async () => {
  for (const elapsed of [1, 9.9]) {
    const s = setup({input: {...catalogue(), fallback: []}});
    s.p.seek(elapsed); await flush();
    const media = s.media[0]; let currentTime = 0;
    media.duration = 11.7;
    Object.defineProperty(media, 'currentTime', {get: () => currentTime, set: value => currentTime = Math.min(value, media.duration)});
    media.ready(); await flush();
    assert.deepEqual([s.p.phase, s.p.elapsed, s.p.quality.active, s.p.quality.outcome.reason], ['error', elapsed, null, 'mapping-failed']);
    assert.equal(media.currentTime, 0, 'Reject the incomplete interval before positioning');
    s.p.destroy();
  }
});

test('selecting a healthy active quality is a no-op after autoplay rejection', async () => {
  const s = setup(); await s.prime();
  s.media[0].start = () => Promise.reject(Object.assign(new Error('Blocked'), {name: 'NotAllowedError'}));
  s.p.play(); await flush();
  assert.equal(s.p.error.reason, 'autoplay-blocked');
  const selection = s.p.selectQuality('economy'); await s.ready();
  const ack = await selection;
  assert.deepEqual([ack.status, ack.active, s.p.phase, s.requests.length, s.media[0].playCalls], ['applied', 'economy', 'paused', 1, 1]);
  s.p.destroy();
});

test('availability updates leave healthy fallback playing until a seek or explicit retry', async () => {
  const input = catalogue(); input.default = 'detail'; input.availability = [{detail: 'unavailable'}];
  const s = setup({input}); await s.prime();
  s.p.updateCatalogue('first:1', {...catalogue(), revision: 2, availability: [{detail: 'available'}]});
  assert.deepEqual([s.p.quality.requested, s.p.quality.active, s.p.quality.pending, s.requests.length], ['detail', 'economy', null, 1]);
  s.p.seek(4); await s.ready();
  assert.deepEqual([s.p.quality.requested, s.p.quality.active, s.p.media.currentTime, s.requests.length], ['detail', 'detail', 11, 2]);
  s.p.destroy();
});

test('catalogue listeners can select without an outer restart cancelling their selection', async () => {
  const s = setup(); await s.prime();
  let nested;
  s.p.onCatalogue = () => { nested = s.p.selectQuality('detail'); };
  s.p.updateCatalogue('first:1', {...catalogue(), revision: 2, options: [{id: 'detail', label: 'Detail'}], default: 'detail', fallback: []});
  await s.ready();
  assert.deepEqual([(await nested).status, s.p.quality.active, s.p.quality.revision], ['applied', 'detail', 2]);
  s.p.destroy();
});

test('nested catalogue updates cannot publish or restart an older revision afterwards', async () => {
  const s = setup(); await s.prime();
  const revisions = [];
  s.p.onCatalogue = event => {
    revisions.push(event.quality.revision);
    if (event.quality.revision === 2) s.p.updateCatalogue('first:1', {...catalogue(), revision: 3});
  };
  s.p.updateCatalogue('first:1', {revision: 2, options: [{id: 'detail', label: 'Detail'}], default: 'detail', fallback: []});
  await s.ready();
  assert.deepEqual(revisions, [2, 3]);
  assert.deepEqual([s.p.quality.revision, s.p.quality.requested, s.p.quality.active, s.p.phase], [3, 'detail', 'detail', 'paused']);
  s.p.destroy();
});

test('a nested update during transition publication emits only the current catalogue', async () => {
  const s = setup(); await s.prime();
  const revisions = [];
  s.p.onCatalogue = event => revisions.push(event.quality.revision);
  s.p.onChange = state => {
    if (state.quality.revision === 2) s.p.updateCatalogue('first:1', {...catalogue(), revision: 3});
  };
  s.p.updateCatalogue('first:1', {revision: 2, options: [{id: 'detail', label: 'Detail'}], default: 'detail', fallback: []});
  await s.ready();
  assert.deepEqual(revisions, [3]);
  assert.deepEqual([s.p.quality.revision, s.p.quality.active, s.requests.map(r => r.revision)], [3, 'detail', [1, 3]]);
  s.p.destroy();
});

test('a selection from a cancellation listener takes precedence over a catalogue restart', async () => {
  const s = setup(); await s.prime();
  s.p.session.resolve = request => {s.requests.push(request); return new Promise(() => {});};
  const original = s.p.selectQuality('detail'); await flush();
  let nested;
  const collect = s.p.onQuality;
  s.p.onQuality = event => {
    collect(event);
    if (event.status === 'cancelled') nested = s.p.selectQuality('economy');
  };
  s.p.updateCatalogue('first:1', {...catalogue(), revision: 2}); await flush();
  assert.equal((await original).status, 'cancelled');
  assert.deepEqual([(await nested).status, s.p.quality.requested, s.p.quality.active, s.p.quality.pending, s.requests.length], ['applied', 'economy', 'economy', null, 2]);
  s.p.destroy();
});

test('8 players have independent choices, load IDs and resource uses; invalid calls leave state unchanged', async () => {
  const a = setup(), b = setup({load: 'second:1'}); await a.prime(); await b.prime();
  const before = a.p.state;
  assert.deepEqual(await a.p.selectQuality('missing'), {status: 'rejected', reason: 'unknown-quality'});
  assert.deepEqual(a.p.state, before);
  const ack = a.p.selectQuality('detail'); await a.ready(); await ack;
  assert.deepEqual([a.p.quality.requested, b.p.quality.requested], ['detail', 'economy']);
  a.p.destroy(); assert.equal(b.p.phase, 'paused'); assert.equal(b.released.length, 0);
  b.p.destroy(); assert.equal(b.released.length, 1);
});

test('9 an app provider reports Auto truthfully and confirms a pinned rendition without URL invention', async () => {
  let label = null;
  const adapter = {kind: 'provider', adaptive: true, pinned: true, supports: () => true,
    async attach(media, source) {
      media.src = source.url;
      return {confirmedRendition: source.rendition ?? undefined, rendition: () => label && {label}, detach() {}};
    }};
  const input = {revision: 1, options: [{id: 'auto', label: 'Auto', mode: 'auto', delivery: {kind: 'provider'}}, {id: 'pin', label: 'Pinned', delivery: {kind: 'provider'}}], default: 'auto', fallback: []};
  const resolve = request => ({status: 'source', source: {quality: request.quality, url: 'https://media.test/presentation', delivery: {kind: 'provider', rendition: request.quality === 'pin' ? 'engine-42' : undefined}}});
  const s = setup({input, adapters: [adapter], resolve}); await s.prime();
  assert.equal(s.p.quality.active, 'auto'); assert.equal(s.p.quality.rendition, 'unknown');
  label = '720p'; assert.deepEqual(s.p.quality.rendition, {label: '720p'});
  const ack = s.p.selectQuality('pin'); await s.ready();
  assert.equal((await ack).active, 'pin'); assert.equal(s.media[1].src, 'https://media.test/presentation');
  assert.equal(s.p.quality.rendition, null);
  const absent = setup({input, resolve}); absent.p.seek(3.25); await flush();
  assert.deepEqual(absent.p.quality.options, []); assert.equal(absent.p.quality.outcome.reason, 'unsupported');
  s.p.destroy(); absent.p.destroy();
});
