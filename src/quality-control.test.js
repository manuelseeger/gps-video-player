import test from 'node:test';
import assert from 'node:assert/strict';
import {controlView} from './quality-control.js';

const quality = () => ({options: [{id: 'economy', label: 'Data saver', mode: 'fixed', availability: 'available'},
  {id: 'detail', label: 'Fine view', mode: 'fixed', availability: 'unavailable'}], requested: 'detail', active: 'economy', pending: null, rendition: null, outcome: null});

test('control keeps known unavailable preferences selectable and shows pending separately', () => {
  const q = quality(); q.pending = 'detail';
  assert.deepEqual(controlView(q), {visible: true, selectable: true, options: [{id: 'economy', label: 'Data saver'},
    {id: 'detail', label: 'Fine view (not available for this clip)'}], value: 'detail', status: 'Switching to Fine view…', retry: false});
  q.pending = null; q.outcome = {status: 'applied', outcome: 'fallback'};
  assert.equal(controlView(q).status, 'Playing Data saver. Fine view could not be applied to this clip.');
  q.options[1].availability = 'unknown';
  q.outcome = {status: 'failed', message: 'The service is busy.'};
  assert.equal(controlView(q).status, 'Could not apply Fine view. Playing Data saver. The service is busy.');
  assert.equal(controlView(q).retry, true);
});

test('fallback retry is available for supported preferences except known unavailable choices', () => {
  const q = quality(); q.options[1].availability = 'unknown';
  q.outcome = {status: 'applied', outcome: 'fallback', reason: 'resolver-failed'};
  assert.deepEqual([controlView(q).value, controlView(q).retry], ['detail', true]);
  q.options[1].availability = 'unavailable';
  assert.equal(controlView(q).retry, false);
  q.options[1].availability = 'available'; q.outcome.reason = 'unavailable';
  assert.equal(controlView(q).retry, true, 'New availability permits an explicit retry without interrupting playback');
  q.requested = 'unsupported'; q.outcome = {status: 'failed', message: 'Not supported.'};
  assert.deepEqual([controlView(q).visible, controlView(q).retry], [true, false]);
});

test('autoplay rejection on the active requested quality offers Play without a dead quality retry', () => {
  const q = quality(); q.requested = 'economy';
  q.outcome = {status: 'applied', reason: 'autoplay-blocked'};
  const blocked = {reason: 'autoplay-blocked', message: 'Playback was blocked. Press Play to continue.'};
  const view = controlView(q, blocked);
  assert.deepEqual([view.visible, view.retry, view.status], [true, false, 'Playback was blocked. Press Play to continue.']);
  q.requested = 'detail'; q.options[1].availability = 'available';
  assert.deepEqual([controlView(q, blocked).value, controlView(q, blocked).retry], ['detail', true]);
  q.active = null; q.outcome = {status: 'failed', message: 'The service is busy.'};
  assert.deepEqual([controlView(q, {reason: 'resolver-failed'}).retry, controlView(q).status], [true, 'The service is busy.']);
});

test('a single fixed source keeps quality hidden on errors and Play remains the retry path', () => {
  const q = quality(); q.options.pop(); q.requested = 'economy'; q.active = null;
  q.outcome = {status: 'failed', message: 'Could not decode.'};
  const view = controlView(q, {reason: 'media-failed', message: 'Could not decode.'});
  assert.deepEqual([view.visible, view.selectable, view.retry], [false, false, false]);
});

test('track-only and fixed sources hide quality while Auto is status only', () => {
  assert.equal(controlView(null).visible, false);
  const q = quality(); q.options.pop(); q.requested = 'economy';
  assert.equal(controlView(q).visible, false);
  q.requested = 'unsupported';
  assert.equal(controlView(q, {reason: 'unsupported', message: 'Not supported.'}).selectable, true);
  q.requested = 'economy';
  q.options[0].mode = 'auto'; q.rendition = 'unknown';
  assert.deepEqual([controlView(q).visible, controlView(q).selectable, controlView(q).status], [true, false, 'Playing Data saver (rendition unknown).']);
  q.rendition = {label: '720p'};
  assert.equal(controlView(q).status, 'Playing Data saver (720p).');
});
