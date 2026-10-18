import test from 'node:test';
import assert from 'node:assert/strict';
import {shortcutForEvent} from './shortcuts.js';

const control = (disabled = false, visible = true) => ({
  matches: () => disabled,
  getClientRects: () => visible ? [{}] : [],
});
const event = (key, extra = {}) => ({key, target:{closest:() => null}, ...extra});
const shortcuts = [
  {key:'m', element:control(), activation:'click'},
  {key:'.', element:control(), activation:'click', repeat:true},
  {key:'Space', element:control(), activation:'click'},
  {key:'p', element:control(), activation:'focus'},
];

test('selects actions, focus controls, Space, and shifted printable keys', () => {
  assert.equal(shortcutForEvent(event('M', {shiftKey:true}), shortcuts), shortcuts[0]);
  assert.equal(shortcutForEvent(event('>', {shiftKey:true}), shortcuts), shortcuts[1]);
  assert.equal(shortcutForEvent(event(' '), shortcuts), shortcuts[2]);
  assert.equal(shortcutForEvent(event('p'), shortcuts), shortcuts[3]);
  assert.equal(shortcutForEvent(event('ArrowLeft'), shortcuts), null);
});

test('respects cancelled events, composition, and command modifiers', () => {
  assert.equal(shortcutForEvent(event('m'), shortcuts), shortcuts[0]);
  for (const guard of [{defaultPrevented:true}, {isComposing:true}, {keyCode:229}, {ctrlKey:true}, {metaKey:true}, {altKey:true}]) {
    assert.equal(shortcutForEvent(event('m', guard), shortcuts), null);
  }
});

test('reserves editable, link, and map subtrees but allows app buttons', () => {
  const button = {closest: selector => selector === 'button,[role="button"]' ? {} : null};
  assert.equal(shortcutForEvent(event('m', {target:button}), shortcuts), shortcuts[0]);
  assert.equal(shortcutForEvent(event(' ', {target:button}), shortcuts), null);
  assert.equal(shortcutForEvent(event('m', {target:{isContentEditable:true}}), shortcuts), null);
  assert.equal(shortcutForEvent(event('m', {target:{closest:()=>({})}}), shortcuts), null);
});

test('only sync nudges repeat', () => {
  assert.equal(shortcutForEvent(event('.', {repeat:true}), shortcuts), shortcuts[1]);
  assert.equal(shortcutForEvent(event('m', {repeat:true}), shortcuts), null);
  assert.equal(shortcutForEvent(event('p', {repeat:true}), shortcuts), null);
});

test('skips disabled actions and disabled or hidden focus controls', () => {
  assert.equal(shortcutForEvent(event('p'), shortcuts), shortcuts[3]);
  for (const [activation, disabled, visible] of [['click',true,true], ['focus',true,true], ['focus',false,false]]) {
    assert.equal(shortcutForEvent(event('p'), [{key:'p',element:control(disabled,visible),activation}]), null);
  }
});
