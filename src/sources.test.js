import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveries, parseCatalogue, planCandidates, requestSource, staticResolver} from './sources.js';

const input = () => ({revision: 1, options: [{id: 'economy', label: 'Data saver'}, {id: 'detail', label: 'Detail'}], default: 'detail', fallback: ['economy', 'detail']});
const deliveries = createDeliveries([], type => type === 'video/unknown' ? '' : 'maybe');
const flush = () => new Promise(resolve => setImmediate(resolve));
function request(resolve, extra = {}) {
  const controller = new AbortController();
  const req = {load: 'one:1', revision: 1, transition: 'one:1:t1', clip: {index: 0, durationSeconds: 10, startUtc: '2030-01-01T00:00:00Z'}, quality: 'detail', localTime: 3.25, request: 'one:1:t1:r1', signal: controller.signal};
  return {controller, promise: requestSource(resolve, req, {controller, deliveries, option: parseCatalogue(input(), {clipCount: 1, deliveries}).byId.get('detail'), timeoutMs: 50, ...extra})};
}

test('catalogue preserves order, unavailable hints and declared unsupported default', () => {
  const raw = input();
  raw.options[1].delivery = {kind: 'dash'};
  raw.availability = [{economy: 'available', detail: 'unknown'}];
  const catalogue = parseCatalogue(raw, {clipCount: 1, deliveries});
  assert.equal(catalogue.default, 'detail');
  assert.deepEqual(catalogue.options.filter(o => o.supported).map(o => o.id), ['economy']);
  assert.deepEqual(planCandidates(catalogue, 'detail'), ['detail', 'economy']);
  raw.options[0].label = 'Changed';
  assert.equal(catalogue.byId.get('economy').label, 'Data saver');
  assert.equal(catalogue.availability(0, 'detail'), 'unknown');
});

test('catalogue rejects invalid identities, policy, revisions and availability', () => {
  for (const change of [v => v.options.push(v.options[0]), v => v.default = 'missing', v => v.fallback = ['detail', 'detail'], v => v.revision = 1.5, v => v.options[0].mode = 'best', v => v.availability = [{other: 'available'}], v => v.options[0].width = -1]) {
    const raw = input(); change(raw);
    assert.throws(() => parseCatalogue(raw, {clipCount: 1, deliveries}), /Invalid quality catalogue/);
  }
});

test('static descriptors preserve signed bytes and have one release per acquired use', async () => {
  let released = 0;
  const resolve = staticResolver([{detail: {url: 'https://other.test/arbitrary?sig=%7Bxx%7D&x=a+b', mediaStartSeconds: 7, release: () => released++}}]);
  const result = await request(resolve).promise;
  assert.equal(result.status, 'source');
  assert.equal(result.lease.source.url, 'https://other.test/arbitrary?sig=%7Bxx%7D&x=a+b');
  assert.equal(result.lease.source.mediaStartSeconds, 7);
  result.lease.release(); result.lease.release();
  assert.equal(released, 1);
});

test('normalization and static resolution preserve the release method receiver', async () => {
  for (const staticSource of [false, true]) {
    const source = {quality: 'detail', url: 'https://media.test/owned', releases: 0,
      release() { assert.equal(this, source); this.releases++; }};
    const resolve = staticSource ? staticResolver([{detail: source}]) : () => ({status: 'source', source});
    const result = await request(resolve).promise;
    assert.equal(result.status, 'source');
    result.lease.release(); result.lease.release();
    assert.equal(source.releases, 1);
    let complete;
    const late = request(req => new Promise(done => complete = () => done(resolve(req))));
    await flush(); late.controller.abort();
    assert.deepEqual(await late.promise, {status: 'cancelled'});
    complete(); await flush();
    assert.equal(source.releases, 2);
    source.type = 'video/unknown';
    assert.deepEqual(await request(resolve).promise, {status: 'unsupported'});
    assert.equal(source.releases, 3);
  }
});

test('aborted and timed out requests release late descriptors without accepting them', async () => {
  let resolve, released = 0;
  const first = request(() => new Promise(done => resolve = done));
  await flush(); first.controller.abort();
  assert.deepEqual(await first.promise, {status: 'cancelled'});
  resolve({status: 'source', source: {quality: 'detail', url: 'blob:https://app.test/id', release: () => released++}});
  await flush(); assert.equal(released, 1);
  const second = request(() => new Promise(done => resolve = done), {timeoutMs: 5});
  const keepAlive = setTimeout(() => {}, 100);
  assert.deepEqual(await second.promise, {status: 'timeout'});
  clearTimeout(keepAlive);
  assert.equal(second.controller.signal.aborted, true);
  resolve({status: 'source', source: {quality: 'detail', url: 'https://app.test/expired', release: () => released++}});
  await flush(); assert.equal(released, 2);
});

test('invalid or unsupported sources are cleaned up and exceptions stay private', async () => {
  let released = 0;
  for (const value of [{url: './relative'}, {quality: 'economy'}, {mediaStartSeconds: -1}, {url: 'blob:https://app.test/id', release: undefined}, {type: 'video/unknown'}]) {
    const source = {quality: 'detail', url: 'https://app.test/a', release: () => released++, ...value};
    const result = await request(() => ({status: 'source', source})).promise;
    assert.equal(result.status, value.type ? 'unsupported' : 'invalid-source');
  }
  assert.equal(released, 4);
  const failed = await request(() => { throw new Error('https://private.test/?token=private'); }).promise;
  assert.deepEqual(failed, {status: 'resolver-failed', message: 'The video service could not supply a source.', retryable: true});
  const unsafe = await request(() => ({status: 'failed', message: 'https://private.test/token', retryable: false})).promise;
  assert.deepEqual(unsafe, {status: 'resolver-failed', message: 'The video service could not supply a source.', retryable: false});
});

test('an expired resolution cannot win before a delayed timeout callback', async () => {
  let time = 0, done, released = 0;
  const pending = request(() => new Promise(resolve => done = resolve), {now: () => time, timers: {setTimeout: () => 1, clearTimeout() {}}});
  await flush(); time = 51;
  done({status: 'source', source: {quality: 'detail', url: 'https://media.test/late', release: () => released++}});
  assert.deepEqual(await pending.promise, {status: 'timeout'});
  assert.equal(pending.controller.signal.aborted, true); assert.equal(released, 1);
});

test('opaque option IDs do not inherit object properties', async () => {
  const raw = {revision: 1, options: [{id: 'constructor', label: 'Custom'}], default: 'constructor', fallback: [], availability: [{}]};
  const catalogue = parseCatalogue(raw, {clipCount: 1, deliveries});
  assert.equal(catalogue.availability(0, 'constructor'), 'unknown');
  assert.deepEqual(staticResolver([{}])({clip: {index: 0}, quality: 'constructor'}), {status: 'unavailable'});
});

test('Auto and pinned modes require explicit capabilities and fixed acknowledgement', async () => {
  const raw = {revision: 1, options: [{id: 'automatic', label: 'Auto', mode: 'auto', delivery: {kind: 'provider'}}, {id: 'fixed', label: 'Pinned', delivery: {kind: 'provider'}}], default: 'automatic', fallback: []};
  const noProvider = parseCatalogue(raw, {clipCount: 1, deliveries});
  assert.deepEqual(noProvider.options.map(o => o.supported), [false, false]);
  let detached = 0;
  const adapter = {kind: 'provider', adaptive: true, pinned: false, supports: () => true, attach: async () => ({rendition: () => null, detach: () => detached++})};
  let supported = createDeliveries([adapter]);
  assert.deepEqual(parseCatalogue(raw, {clipCount: 1, deliveries: supported}).options.map(o => o.supported), [true, false]);
  adapter.pinned = true; supported = createDeliveries([adapter]);
  const option = parseCatalogue(raw, {clipCount: 1, deliveries: supported}).byId.get('fixed');
  await assert.rejects(supported.attach({}, {url: 'https://media.test/adaptive', delivery: {kind: 'provider', rendition: 'pin'}}, option, new AbortController().signal), /Unsupported/);
  assert.equal(detached, 1);
  adapter.attach = async () => ({confirmedRendition: 'pin', rendition: () => ({label: '720p'}), detach() {}});
  const attached = await supported.attach({}, {url: 'https://media.test/adaptive', delivery: {kind: 'provider', rendition: 'pin'}}, option, new AbortController().signal);
  assert.deepEqual(attached.rendition(), {label: '720p'});
});
