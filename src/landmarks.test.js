import test from 'node:test';
import assert from 'node:assert/strict';
import {detectLandmarks} from './landmarks.js';
import {parseIGC} from './flight.js';
import {landmarkTracks} from '../tests/landmark-fixtures.js';

const fixes = samples => samples.map(([t, speed]) => ({t, speed}));

test('qualifies both transitions at the first sample, including UTC zero', () => {
  assert.deepEqual(detectLandmarks(fixes([[-4, 0], [-1, 3.99], [0, 8], [3, 9], [4, 0], [7, 0]])),
    {takeoff: 0, landing: 4});
});

test('short runs and intermediate speeds cannot qualify a segment', () => {
  assert.deepEqual(detectLandmarks(fixes([[0, 0], [2, 0], [3, 8], [6, 8]])), {takeoff: null, landing: null});
  assert.deepEqual(detectLandmarks(fixes([[0, 0], [3, 0], [4, 8], [5, 4], [8, 8], [10, 8]])),
    {takeoff: null, landing: null});
  assert.deepEqual(detectLandmarks(fixes([[0, 0], [3, 0], [4, 7.99], [8, 8], [11, 8]])),
    {takeoff: 8, landing: null});
});

test('incomplete tracks never substitute their endpoints', () => {
  assert.deepEqual(detectLandmarks([]), {takeoff: null, landing: null});
  assert.deepEqual(detectLandmarks(fixes([[0, 8], [3, 8], [4, 0], [7, 0]])), {takeoff: null, landing: 4});
  assert.deepEqual(detectLandmarks(fixes([[0, 0], [3, 0], [4, 8], [7, 8]])), {takeoff: 4, landing: null});
  assert.deepEqual(detectLandmarks(fixes([[0, 8], [3, 8]])), {takeoff: null, landing: null});
});

test('uses parsed IGC speeds without event or declaration records', () => {
  assert.deepEqual(detectLandmarks(parseIGC(landmarkTracks.both)), {takeoff: 43208, landing: 43222});
  assert.deepEqual(detectLandmarks(parseIGC(landmarkTracks.ground)), {takeoff: null, landing: null});
  assert.deepEqual(detectLandmarks(parseIGC(landmarkTracks.startsAirborne)), {takeoff: null, landing: 43213});
  assert.deepEqual(detectLandmarks(parseIGC(landmarkTracks.endsAirborne)), {takeoff: 43208, landing: null});
});
