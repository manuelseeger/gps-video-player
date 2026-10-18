import test from 'node:test';
import assert from 'node:assert/strict';
import {FlightClock} from './flight-time.js';
import {utcInstant} from './manifest.js';
test('explicit UTC dates survive midnight and timezone/DST transitions',()=>{
  const clock = new FlightClock();
  assert.equal(clock.format(utcInstant('2030-01-01T23:59:59Z')),'23:59:59');
  assert.match(clock.zoneLabel(utcInstant('2030-01-02T00:00:01Z')),/^2030-01-02 · UTC/);
  const local = new FlightClock('Europe/Rome');
  assert.equal(local.format(utcInstant('2026-10-25T00:59:59Z')),'02:59:59');
  assert.equal(local.format(utcInstant('2026-10-25T01:00:00Z')),'02:00:00');
  assert.equal(local.format(utcInstant('2026-10-25T01:00:00.125Z'),3),'02:00:00.125');
  assert.throws(()=>new FlightClock('invalid-zone'));assert.throws(()=>clock.format(0,4));
});
