import test from 'node:test';
import assert from 'node:assert/strict';
import {SEEK_STEPS, seekDeltaForEvent} from './seek-keys.js';

const event = (key, props = {}) => ({key, ...props});
const field = {closest: selector => selector.includes('input') ? {} : null};

test('step table defines the seek sizes', () => {
  assert.deepEqual(SEEK_STEPS.map(step => step.seconds), [10, 60, 600]);
});

test('arrows map to signed steps', () => {
  assert.equal(seekDeltaForEvent(event('ArrowLeft')), -10);
  assert.equal(seekDeltaForEvent(event('ArrowRight')), 10);
  assert.equal(seekDeltaForEvent(event('ArrowLeft', {shiftKey: true})), -60);
  assert.equal(seekDeltaForEvent(event('ArrowRight', {shiftKey: true})), 60);
  assert.equal(seekDeltaForEvent(event('ArrowLeft', {shiftKey: true, ctrlKey: true})), -600);
  assert.equal(seekDeltaForEvent(event('ArrowRight', {shiftKey: true, ctrlKey: true})), 600);
});

test('unrelated keys and modifiers are ignored', () => {
  for (const props of [{ctrlKey: true}, {altKey: true}, {metaKey: true}, {shiftKey: true, altKey: true},
    {shiftKey: true, ctrlKey: true, metaKey: true}, {shiftKey: true, ctrlKey: true, altKey: true},
    {isComposing: true}, {keyCode: 229}, {defaultPrevented: true}]) {
    assert.equal(seekDeltaForEvent(event('ArrowRight', props)), null);
  }
  assert.equal(seekDeltaForEvent(event('ArrowUp')), null);
  assert.equal(seekDeltaForEvent(event('a')), null);
});

test('reserved controls keep arrows', () => {
  assert.equal(seekDeltaForEvent(event('ArrowRight', {target: field})), null);
  assert.equal(seekDeltaForEvent(event('ArrowRight', {target: {isContentEditable: true}})), null);
  assert.equal(seekDeltaForEvent(event('ArrowRight', {target: {closest: () => null}})), 10);
});
