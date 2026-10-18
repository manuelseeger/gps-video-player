import assert from 'node:assert/strict';
import {headingDelta} from '../src/heading.js';

// Read the navigation compass, which MapLibre updates from its actual camera
// bearing on each move. This tests jumpTo and HUD look-at geometry, not a mock
// camera or an extra player diagnostic API. Run at 1x with continuous playback.
export async function verifyCameraTracking(page, mode = 'map') {
  await page.evaluate(mode => {
    const player = window.demo.players[0];
    const root = document.getElementById('first').firstElementChild.shadowRoot;
    player.pause(); player.setRate(1); player.seek(26);
    if (player.state.mode !== mode) root.getElementById('mode').click();
  }, mode);
  await page.waitForFunction(() => {
    const state = window.demo.players[0].state;
    const compass = document.getElementById('first').firstElementChild.shadowRoot.querySelector('.maplibregl-ctrl-compass .maplibregl-ctrl-icon');
    const rotations = [...compass.style.transform.matchAll(/rotate(?:Z)?\(([-\d.e+]+)deg\)/g)];
    const bearing = -Number(rotations.at(-1)?.[1]);
    const delta = ((state.sample.heading - bearing + 180) % 360 + 360) % 360 - 180;
    return state.elapsed === 26 && state.phase === 'paused' && Math.abs(delta) < 1;
  });
  await page.evaluate(() => {
    window.cameraTrace = [];
    const player = window.demo.players[0];
    const compass = document.getElementById('first').firstElementChild.shadowRoot.querySelector('.maplibregl-ctrl-compass .maplibregl-ctrl-icon');
    let previous;
    function record(now) {
      const state = player.state;
      const rotations = [...compass.style.transform.matchAll(/rotate(?:Z)?\(([-\d.e+]+)deg\)/g)];
      const bearing = -Number(rotations.at(-1)?.[1]);
      if (bearing !== previous) {
        window.cameraTrace.push({now, elapsed:state.elapsed, course:state.sample.heading, bearing});
        previous = bearing;
      }
      if (state.elapsed < 69) requestAnimationFrame(record);
      else { player.pause(); window.cameraTraceDone = true; }
    }
    window.cameraTraceDone = false;
    requestAnimationFrame(record);
    player.play();
  });
  await page.waitForFunction(() => window.cameraTraceDone, null, {timeout:90000});
  const trace = await page.evaluate(() => window.cameraTrace);
  const thermal = trace.filter(p => p.elapsed >= 30 && p.elapsed <= 59);
  assert.ok(thermal.length > 2, 'Camera samples exist in both rotations');
  const steps = thermal.slice(1).map((p,i) => ({elapsed:p.elapsed, delta:headingDelta(thermal[i].bearing,p.bearing), dt:(p.now-thermal[i].now)/1000}));
  const lag = Math.max(...thermal.map(p => Math.abs(headingDelta(p.bearing,p.course))));
  const result = {
    mode, samples:thermal.length,
    turnDegrees:steps.reduce((sum,p) => sum+p.delta,0),
    secondRotationDegrees:steps.filter(p => p.elapsed >= 46 && p.elapsed <= 58).reduce((sum,p) => sum+p.delta,0),
    minStep:Math.min(...steps.map(p => p.delta)),
    maxSpeed:Math.max(...steps.map(p => Math.abs(p.delta)/p.dt)),
    maxLag:lag,
  };
  console.log('Actual camera tracking:', JSON.stringify(result));
  assert.ok(thermal.length > 60, 'Camera sampled throughout both rotations');
  assert.ok(result.minStep >= -.2, `${mode}: no reverse spin through either rotation`);
  assert.ok(result.maxSpeed < 65, `${mode}: no fast camera spin`);
  assert.ok(lag < 35, `${mode}: camera stays near ground course`);
  assert.ok(result.turnDegrees > 620 && result.turnDegrees < 690, `${mode}: camera completes both rotations continuously`);
  assert.ok(result.secondRotationDegrees > 240 && result.secondRotationDegrees < 300, `${mode}: second rotation keeps turning right`);
  return result;
}
