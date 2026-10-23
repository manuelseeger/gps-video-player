import * as maplibregl from 'maplibre-gl';
import {MapboxOverlay} from '@deck.gl/mapbox';
import {PathLayer, ScatterplotLayer, LineLayer} from '@deck.gl/layers';
import {parseIGC, sample, varioColor, clamp} from './flight.js';
import {FlightClock} from './flight-time.js';
import {detectLandmarks} from './landmarks.js';
import {Timeline} from './timeline.js';
import {Playback} from './playback.js';
import {createDeliveries, parseCatalogue, staticResolver} from './sources.js';
import {createQualityControl} from './quality-control.js';
import {shortcutForEvent} from './shortcuts.js';
import css from './style.css?inline';
import mapCss from 'maplibre-gl/dist/maplibre-gl.css?inline';
import {acquireRenderer, releaseRenderer} from './renderer-lifecycle.js';
import {loadManifest} from './manifest.js';
import {template} from './template.js';
import {FlightMapView} from './map-view.js';
import {smoothHeading} from './heading.js';
import {PlayerAttributionControl, parseInitialAttribution} from './attribution-control.js';

export function createPlayer(container, options = {}) {
  if (!container || typeof container.append !== 'function') throw new TypeError('A container element is required');
  const initialAttribution = parseInitialAttribution(options.initialAttribution);
  const instanceId = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
  const probe = document.createElement('video');
  const deliveries = createDeliveries(options.deliveries, type => probe.canPlayType(type));
  const timeouts = {resolveMs: options.sourceTimeouts?.resolveMs ?? 15000, readyMs: options.sourceTimeouts?.readyMs ?? 20000};
  if (Object.values(timeouts).some(ms => !Number.isFinite(ms) || ms <= 0 || ms > 60000)) throw new Error('Invalid source timeouts');
  const host = document.createElement('div');
  host.style.cssText = 'display:block;width:100%;height:100%;min-height:480px';
  container.append(host);
  const isFullscreen = () => host.getRootNode().fullscreenElement === host;
  const root = host.attachShadow({mode:'open'});
  const styleElement = document.createElement('style');
  if (options.nonce) styleElement.setAttribute('nonce', options.nonce);
  styleElement.textContent = mapCss + '\n' + css;
  root.append(styleElement);
  const shell = document.createElement('section');
  shell.className = 'player'; shell.tabIndex = 0; shell.setAttribute('aria-label', 'Flight video player');
  shell.innerHTML = template;
  root.append(shell);
  let destroyed = false, generation = 0, controller, raf = 0, ownsWorker = false;
  const observers = [];
  const events = new EventTarget();
  const listeners = new Map();
  const uiController = new AbortController();
  function emit(type, detail) { if (!destroyed) events.dispatchEvent(new CustomEvent(type, {detail})); }

const $ = id => root.getElementById(id);
function setButtonLabel(id, label) { $(id).firstChild.textContent = `${label} `; }
const renderQuality = createQualityControl({row: $('quality-row'), label: $('quality-control'), select: $('quality'),
  status: $('quality-status'), retry: $('quality-retry'), onSelect: id => api.selectQuality(id),
  onRetry: () => playback && api.selectQuality(playback.requested)});
const panel = $('map-panel'), inset = $('inset-panel');
let timeline, playback, flightClock;
let landmarks;
let videoSpans = [];
let fixes, segments, map, overlay, ready = false, mode = 'map', mainView = 'video', following = true, headingFollow = true, drop = false;
let advancedSync = options.advancedSync === true, nudge = 0, current, lastFrame = 0, lastIndex = -1, flown = [], heading = null, lastCamera = 0;
let mapPointerHeld = false;
for (const event of ['pointerup', 'pointercancel']) window.addEventListener(event, e => {
  if (e.isPrimary) mapPointerHeld = false;
}, {capture:true, signal:uiController.signal});
const initialTime = Number.isFinite(options.initialTime) ? options.initialTime : 0;
let noticeTimer;
function notice(message) { $('notice').textContent = message; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').textContent = '', 7000); }
const durationText = t => `${t < 0 ? '−' : ''}${Math.floor(Math.abs(t) / 60)}:${String(Math.floor(Math.abs(t) % 60)).padStart(2, '0')}`;
function updateSync() {
  $('offset').textContent = `${nudge >= 0 ? '+' : ''}${nudge.toFixed(1)} s`;
  videoSpans = timeline?.coverage(nudge) ?? [];
  const showRow = advancedSync || nudge !== 0;
  $('sync-controls').hidden = !showRow;
  for (const id of ['minus', 'plus', 'reset']) { $(id).hidden = !advancedSync; $(id).disabled = !advancedSync; }
  $('advanced').setAttribute('aria-pressed', String(advancedSync));
  $('advanced').classList.toggle('active', advancedSync);
  shell.classList.toggle('sync-hidden', !showRow);
  shell.classList.toggle('sync-readout', showRow && !advancedSync);
}
function setAdvancedSync(on) {
  advancedSync = !!on;
  updateSync();
}
function adjustSync(delta, reset = false) {
  nudge = reset ? 0 : Math.round((nudge + delta) * 10) / 10;
  playback?.setNudge(nudge);
  updateSync();
}
let seekTimer, queuedSeek = null;
function seek(t) {
  clearTimeout(seekTimer);
  queuedSeek = null;
  playback?.seek(t);
}
function queueSeek(t) {
  clearTimeout(seekTimer);
  queuedSeek = t;
  seekTimer = setTimeout(() => seek(t), 150);
}
function finishSeek() { if (queuedSeek !== null) seek(queuedSeek); }
function seekUtc(t) { if (timeline) seek(timeline.elapsedAtUtc(t, nudge)); }
function syncRate(rate) {
  const select = $('rate');
  if (select.value === String(rate)) return;
  select.querySelector('[data-api-rate]')?.remove();
  if (![...select.options].some(option => option.value === String(rate))) {
    const option = document.createElement('option');
    option.value = String(rate); option.textContent = `${rate}×`; option.dataset.apiRate = '';
    select.append(option);
  }
  select.value = String(rate);
}
function playbackChanged(state) {
  syncRate(state.rate);
  setButtonLabel('play', state.playing ? '❚❚ Pause' : '▶ Play');
  $('seek').min = state.start;
  $('seek').max = state.end;
  if (queuedSeek === null) $('seek').value = state.elapsed;
  $('elapsed').textContent = `${durationText(state.elapsed)} / ${durationText(state.end)}`;
  renderQuality(state);
  const label = state.clipIndex === null ? 'No video' : state.phase === 'error' ? `${state.error?.message ?? 'Video error'} Press Play to retry.` : ['loading', 'buffering'].includes(state.phase) ? 'Loading video…' : '';
  $('video-status').textContent = label;
  $('video-status').hidden = !label;
  emit('statechange', state);
}
function setFollowing(value) {
  following = value;
  setButtonLabel('follow', value ? 'Following' : '↟ Follow pilot');
  $('follow').classList.toggle('active', value);
  panel.classList.toggle('orbit', !value);
}
function applyMode() {
  const hud = mode === 'hud';
  const mapMain = !hud && mainView === 'map';
  (hud || mapMain ? $('views') : inset).append(panel);
  (mapMain ? inset : $('views')).append($('video-panel'));
  $('views').classList.toggle('hud', hud);
  panel.classList.toggle('main-view', hud || mapMain);
  panel.classList.toggle('inset-view', !hud && !mapMain);
  panel.classList.toggle('hud', hud);
  $('video-panel').classList.toggle('main-view', !mapMain);
  $('video-panel').classList.toggle('inset-view', mapMain);
  setButtonLabel('mode', hud ? 'HUD' : 'Map');
  $('swap').setAttribute('aria-pressed', String(mainView === 'map'));
  $('swap').classList.toggle('active', mainView === 'map');
  $('swap').disabled = hud;
  $('inset-handle').tabIndex = hud ? -1 : 0;
  $('inset-handle').setAttribute('aria-disabled', String(hud));
  if (hud) dragging = null;
  else clampInset();
  $('inset-handle').firstElementChild.textContent = mapMain ? '▶ VIDEO' : '↟ TERRAIN / LIVE TRACK';
  if (ready) {
    // Terrain stays enabled in HUD too: deck's interleaved camera sync relies on MapLibre's terrain-aware
    // transform, and the drop line needs ground elevation. Only the imagery is hidden.
    for (const layer of map.getStyle().layers) {
      if (layer.type !== 'custom') map.setLayoutProperty(layer.id, 'visibility', hud ? 'none' : (layerVisibility.get(layer.id) ?? 'visible'));
    }
    map.resize();
    updateCamera(current, true);
  }
  $('map').style.opacity = hud || mapMain ? 1 : $('opacity').value;
  $('opacity').disabled = hud || mapMain;
}
// Destination point from lon/lat given bearing (deg) and distance (m); flat-earth is fine at these ranges.
function offset(p, bearingDeg, metres) {
  const b = bearingDeg * Math.PI / 180, dLat = metres * Math.cos(b) / 111320;
  return [p.lon + metres * Math.sin(b) / (111320 * Math.cos(p.lat * Math.PI / 180)), p.lat + dLat];
}
const HUD = {back: 45, up: 12, ahead: 350, below: 110};
function updateCamera(p, force = false) {
  if (!p || mapPointerHeld || (!following && !force)) return;
  const now = performance.now();
  // Use elapsed time even when rendering is slow; capping it makes smoothing fall behind.
  const dt = (now - lastCamera) / 1000; lastCamera = now;
  if (heading === null || force) heading = p.heading;
  // Exponential smoothing of GPS course (ground track is noisy while thermalling).
  // Keep accumulated turns; shortest-arc math must handle an unbounded heading.
  heading = smoothHeading(heading, p.heading, dt);
  if (mode === 'hud') {
    // Chase camera: slightly behind/above the pilot, looking forward and down along the heading.
    const dir = headingFollow ? heading : map.getBearing();
    const options = map.calculateCameraOptionsFromTo(offset(p, dir + 180, HUD.back), p.alt + HUD.up, offset(p, dir, HUD.ahead), p.alt - HUD.below);
    map.jumpTo(options);
    return;
  }
  map.setCenterElevation(p.alt);
  map.jumpTo({center:[p.lon, p.lat], ...(headingFollow ? {bearing:heading} : {}), ...(force ? {zoom:14.3, pitch:64} : {})});
}
// deck's pixel units misbehave when the camera is ~50 m from the object (HUD chase cam), so size in metres there.
const markerSize = px => mode === 'hud' ? {getRadius:px * 0.035, radiusUnits:'meters'} : {getRadius:px, radiusUnits:'pixels'};
function layers(p) {
  if (p.index !== lastIndex) { lastIndex = p.index; flown = segments.slice(0, p.index); }
  const common = {getPath:d => d.path, getColor:d => d.color, widthUnits:'pixels', widthMinPixels:3, billboard:true, capRounded:true, jointRounded:true, parameters:{depthCompare:'always', depthWriteEnabled:false}};
  // Explicit MSL XYZ; terrain is exaggeration=1. Depth-always avoids GPS/DEM clipping near launch.
  const result = [
    new PathLayer({...common, id:'future-track', data:segments, getWidth:3, getColor:d => [d.color[0], d.color[1], d.color[2], mode === 'hud' ? 80 : 60], updateTriggers:{getColor:mode}}),
    new PathLayer({...common, id:'flown-track', data:flown, getWidth:mode === 'hud' ? 5 : 4}),
    new PathLayer({...common, id:'current-segment', data:[{path:[fixes[p.index].position,p.position],color:varioColor(p.vario)}], getWidth:5}),
  ];
  if (drop) {
    const terrain = map.queryTerrainElevation([p.lon,p.lat]) ?? p.alt;
    result.push(new LineLayer({id:'altitude-drop',data:[{a:[p.lon,p.lat,terrain], b:p.position}],getSourcePosition:d=>d.a,getTargetPosition:d=>d.b,getColor:[231,250,255,115],getWidth:1,widthUnits:'pixels',parameters:{depthCompare:'always',depthWriteEnabled:false}}));
  }
  result.push(new ScatterplotLayer({id:'pilot-halo',data:[p],getPosition:d=>d.position,...markerSize(13),billboard:true,getFillColor:[10,25,35,180],stroked:true,getLineColor:[255,255,255,230],lineWidthUnits:'pixels',getLineWidth:2,parameters:{depthCompare:'always',depthWriteEnabled:false}}));
  result.push(new ScatterplotLayer({id:'pilot',data:[p],getPosition:d=>d.position,...markerSize(6),billboard:true,getFillColor:[255,255,255],parameters:{depthCompare:'always',depthWriteEnabled:false}}));
  return result;
}
// The profile is pre-rendered twice (dim + bright) per size; each frame only composites them and draws the cursor.
let profileCache = null;
function buildProfile(w, h, dpr) {
  const min = Math.floor(fixes.reduce((v, f) => Math.min(v, f.alt), Infinity)/100)*100;
  const max = Math.max(min + 100, Math.ceil(fixes.reduce((v, f) => Math.max(v, f.alt), -Infinity)/100)*100);
  const x = t => (t-fixes[0].t)/(fixes.at(-1).t-fixes[0].t)*w;
  const y = alt => h-8-(alt-min)/(max-min)*(h-18);
  const layer = alpha => {
    const c = document.createElement('canvas'); c.width = w*dpr; c.height = h*dpr;
    const ctx = c.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.lineWidth = 1.8;
    for (let i=0;i<fixes.length-1;i++) { const a=fixes[i], b=fixes[i+1]; ctx.strokeStyle=`rgba(${varioColor(a.vario).slice(0,3).join(',')},${alpha})`; ctx.beginPath(); ctx.moveTo(x(a.t),y(a.alt)); ctx.lineTo(x(b.t),y(b.alt)); ctx.stroke(); }
    return c;
  };
  return {w, h, dpr, min, max, x, y, dim:layer(.35), bright:layer(1)};
}
function renderProfile(p) {
  const canvas = $('profile'), rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio, w = rect.width, h = rect.height;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) {canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);}
  if (!profileCache || profileCache.w !== w || profileCache.h !== h || profileCache.dpr !== dpr) profileCache = buildProfile(w, h, dpr);
  const {min, max, x, y, dim, bright} = profileCache;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(dim, 0, 0);
  const xx = x(p.t), cut = Math.max(0, Math.round(xx*dpr));
  if (cut > 0) ctx.drawImage(bright, 0, 0, cut, canvas.height, 0, 0, cut, canvas.height);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  for(let i=0;i<3;i++) { const yy = 10+i*(h-18)/2; ctx.strokeStyle='#91b0c322'; ctx.lineWidth=1; ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(w,yy);ctx.stroke();ctx.fillStyle='#9bb1ba';ctx.font='9px monospace';ctx.fillText(`${Math.round(max-i*(max-min)/2)}m`,2,yy-2); }
  ctx.fillStyle='#8b9aa3';
  for (const span of videoSpans) ctx.fillRect(x(span.start), h-5, x(span.end)-x(span.start), 4);
  ctx.strokeStyle='#eefff8';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xx,0);ctx.lineTo(xx,h);ctx.stroke();ctx.fillStyle='#c5ffe7';ctx.beginPath();ctx.arc(xx,y(p.alt),3.5,0,Math.PI*2);ctx.fill();
  canvas.setAttribute('aria-valuenow',Math.round((p.t-fixes[0].t)/(fixes.at(-1).t-fixes[0].t)*100));
  canvas.setAttribute('aria-valuetext',`${flightClock.format(p.t)} ${flightClock.zoneLabel(p.t)}, ${Math.round(p.alt)} metres, ${timeline.locate(playback.elapsed) ? 'video' : 'no video'}`);
}
function frame(now) {
  if (destroyed) return;
  raf = requestAnimationFrame(frame);
  if (!fixes || now-lastFrame<33) return;
  lastFrame=now;
  if (!playback) return;
  playback.tick();
  if (destroyed || !playback || !fixes) return;
  const t=timeline.trackUtc(playback.elapsed,nudge);
  current=sample(fixes,t);
  $('local-time').textContent=flightClock.format(t,1);
  $('time-zone').textContent=flightClock.zoneLabel(t);
  $('alt').textContent=`${Math.round(current.alt)} m`;
  $('vario').textContent=`${current.vario>=0?'+':''}${current.vario.toFixed(1)} m/s`;
  $('vario').style.color=`rgb(${varioColor(current.vario).slice(0,3).join(',')})`;
  $('speed').textContent=`${(current.speed*3.6).toFixed(0)} km/h`;
  renderProfile(current);
  if (ready) {updateCamera(current);overlay.setProps({layers:layers(current)});}
}
const layerVisibility = new Map();
function clearSession(reason = 'load') {
  clearTimeout(seekTimer); clearTimeout(noticeTimer); queuedSeek = null;
  dragging = null; profileDragging = false; mapPointerHeld = false;
  playback?.destroy(reason); playback = null;
  renderQuality(null);
  ready = false;
  if (map) { map.remove(); map = null; overlay = null; }
  if (ownsWorker) { releaseRenderer(); ownsWorker = false; }
  fixes = segments = current = timeline = flightClock = landmarks = null;
  profileCache = null; heading = null; lastIndex = -1; flown = [];
  layerVisibility.clear();
  $('title').textContent = 'Flight player';
  shell.setAttribute('aria-label', 'Flight video player');
  for (const id of ['local-time', 'alt', 'vario', 'speed']) $(id).textContent = '—';
  $('time-zone').textContent = 'TIME';
  $('vario').style.removeProperty('color');
  $('start-label').textContent = $('end-label').textContent = $('notice').textContent = '';
  $('map-status').textContent = 'No flight loaded';
  $('video-status').textContent = 'No flight loaded'; $('video-status').hidden = false;
  const canvas = $('profile');
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.setAttribute('aria-valuenow', '0');
  canvas.setAttribute('aria-valuetext', 'No flight loaded');
  setButtonLabel('play', '▶ Play'); $('elapsed').textContent = '— / —';
  $('seek').min = 0; $('seek').max = 1; $('seek').value = 0;
  syncRate(1); $('volume').value = 1;
  setButtonLabel('mute', (options.muted ?? true) ? 'Muted' : '♪');
  nudge = 0; updateSync();
}
async function load(input, overrides = {}) {
  if (destroyed) throw new Error('Player is destroyed');
  const token = ++generation;
  controller?.abort();
  controller = new AbortController();
  clearSession();
  $('video-status').hidden = false; $('video-status').textContent = 'Loading manifest…';
  $('map-status').textContent = 'Loading manifest…';
  try {
    const {manifest, igc, style} = await loadManifest(input, {...options, ...overrides}, controller.signal);
    if (destroyed || token !== generation) throw new DOMException('Load replaced', 'AbortError');
    fixes = parseIGC(igc);
    const delta = manifest.track.start - fixes[0].t;
    for (const fix of fixes) fix.t += delta;
    landmarks = detectLandmarks(fixes);
    flightClock = new FlightClock(manifest.metadata.timeZone);
    $('title').textContent = manifest.metadata.title || 'Flight player';
    shell.setAttribute('aria-label', manifest.metadata.title || 'Flight video player');
    segments = fixes.slice(0,-1).map((p,i)=>({path:[p.position,fixes[i+1].position],color:varioColor(p.vario)}));
    timeline = new Timeline(manifest, fixes[0].t, fixes.at(-1).t);
    nudge = 0; updateSync();
    let catalogueInput = overrides.qualities ?? manifest.qualities;
    if (overrides.resolveSource && !overrides.qualities && catalogueInput) {
      const {availability, ...unknownAvailability} = catalogueInput;
      catalogueInput = unknownAvailability;
    }
    const parse = input => parseCatalogue(input, {clipCount: manifest.clips.length, deliveries});
    const session = {load: `${instanceId}:${token}`, catalogue: catalogueInput ? parse(catalogueInput) : null,
      parseCatalogue: parse, resolve: overrides.resolveSource ?? staticResolver(manifest.sources, typeof input === 'object' ? input?.clips : undefined), deliveries, timeouts};
    playback = new Playback(timeline, {
      session,
      createMedia: () => {
        const video = document.createElement('video');
        video.className = 'flight-video'; video.playsInline = true; video.preload = 'auto';
        video.crossOrigin = 'anonymous'; video.setAttribute('aria-label','Flight video');
        $('video-panel').prepend(video);
        return video;
      },
      removeMedia: media => media.remove(),
      onChange: playbackChanged,
      onError: (message, detail) => { notice(message); emit('mediaerror', {message, ...detail}); },
      onQuality: detail => emit('qualitychange', detail),
      onCatalogue: detail => emit('qualitycatalogue', detail),
    });
    playback.setAudio(1, options.muted ?? true);
    setButtonLabel('mute', playback.muted ? 'Muted' : '♪');
    emit('qualitycatalogue', {load: session.load, quality: playback.quality});
    if (destroyed || token !== generation) throw new DOMException('Load replaced', 'AbortError');
    playback.seek(initialTime);
    if (destroyed || token !== generation) throw new DOMException('Load replaced', 'AbortError');
    current = sample(fixes, timeline.trackUtc(playback.elapsed));
    $('start-label').textContent = flightClock.format(fixes[0].t) + ' / TAKEOFF';
    $('end-label').textContent = flightClock.format(fixes.at(-1).t) + ' / LANDING';
    for (const layer of style.layers) layerVisibility.set(layer.id, layer.layout?.visibility ?? 'visible');
    $('map-status').textContent = 'Loading map…';
    acquireRenderer(); ownsWorker = true;
    map = new maplibregl.Map({
      container:$('map'), attributionControl:false, center:[current.lon,current.lat],
      zoom:14.3, pitch:64, bearing:current.heading, maxPitch:85,
      canvasContextAttributes:{antialias:true}, style,
      // Tile/media credentials belong in signed resource URLs, never inherited headers.
      transformRequest: url => ({url, credentials:'omit'}),
    });
    map.getCanvas().addEventListener('pointerdown', e => {
      if (e.isPrimary && e.button === 0) mapPointerHeld = true;
    }, {capture:true, signal:uiController.signal});
    // deck.gl 9.4 reads the render transform directly. MapLibre 6 keeps it on its camera.
    // Keep this bridge local to our pinned renderer pair, not on either prototype.
    Object.defineProperty(map, 'transform', {get:() => map._camera.transform});
    map.addControl(new PlayerAttributionControl(initialAttribution));
    map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'top-right');
    map.on('error', e => { if (token === generation) { $('map-status').textContent = 'Map resource error'; emit('maperror', {message:e.error?.message}); } });
    map.on('load', () => {
      if (destroyed || token !== generation) return;
      if (manifest.map.terrain) map.setTerrain(manifest.map.terrain);
      map.setCenterClampedToGround(false);
      overlay = new MapboxOverlay({interleaved:true, views:new FlightMapView(map), layers:layers(current), onError:error => {notice(error.message); emit('maperror',{message:error.message});}});
      map.addControl(overlay); ready = true;
      applyMode(); updateCamera(current,true);
      $('map-status').textContent = '';
      emit('mapready', {});
    });
    for (const event of ['dragstart','zoomstart','rotatestart','pitchstart']) map.on(event,e=>{if(e.originalEvent)setFollowing(false);});
    applyMode();
    emit('load', {metadata:manifest.metadata, state:playback.state});
    return api;
  } catch (error) {
    if (!destroyed && token === generation) {
      clearSession();
      $('video-status').hidden = false; $('video-status').textContent = 'Player could not load';
      notice(error.message); emit('error', {message:error.message});
    }
    throw error;
  }
}
$('mode').onclick=()=>{mode=mode==='map'?'hud':'map';applyMode();};
$('swap').onclick=()=>{mainView=mainView==='video'?'map':'video';applyMode();};
$('follow').onclick=()=>{setFollowing(!following);if(following)updateCamera(current,true);};
$('heading').onclick=()=>{headingFollow=!headingFollow;setButtonLabel('heading',`Heading ${headingFollow?'on':'off'}`);$('heading').classList.toggle('active',headingFollow);};
$('opacity').oninput=()=>{$('map').style.opacity=mode==='hud'||mainView==='map'?1:$('opacity').value;};
$('play').onclick=()=>{if(playback)playback.playing?playback.pause():playback.play();};
$('seek').oninput=e=>queueSeek(+e.target.value);
$('seek').onchange=finishSeek;
$('rate').onchange=e=>playback?.setRate(+e.target.value);
$('volume').oninput=e=>{playback?.setAudio(+e.target.value,false);setButtonLabel('mute','♪');};
$('mute').onclick=()=>{if(playback){playback.setAudio(playback.volume,!playback.muted);setButtonLabel('mute',playback.muted?'Muted':'♪');}};
$('fullscreen').onclick=()=> {
  const promise = isFullscreen() ? document.exitFullscreen() : (!document.fullscreenElement ? host.requestFullscreen() : Promise.resolve());
  promise?.catch(error => notice(error.message));
};
$('minus').onclick=e=>adjustSync(e.shiftKey?-1:-.1);$('plus').onclick=e=>adjustSync(e.shiftKey?1:.1);$('reset').onclick=()=>adjustSync(0,true);$('advanced').onclick=()=>setAdvancedSync(!advancedSync);
$('takeoff').onclick=()=>fixes&&seekUtc(fixes[0].t);$('landing').onclick=()=>fixes&&seekUtc(fixes.at(-1).t);
let profileDragging=false;
function profileSeek(e){if(!fixes)return;const rect=$('profile').getBoundingClientRect();queueSeek(timeline.elapsedAtUtc(fixes[0].t+clamp((e.clientX-rect.left)/rect.width,0,1)*(fixes.at(-1).t-fixes[0].t),nudge));}
$('profile').onpointerdown=e=>{profileDragging=true;$('profile').setPointerCapture(e.pointerId);profileSeek(e);};
$('profile').onpointermove=e=>{if(profileDragging)profileSeek(e);};
$('profile').onpointerup=$('profile').onpointercancel=()=>{profileDragging=false;finishSeek();};
$('profile').onkeydown=e=>{
  if(e.defaultPrevented||e.isComposing||e.keyCode===229||e.ctrlKey||e.metaKey||e.altKey||!fixes)return;
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();seek((playback?.elapsed??0)+(e.key==='ArrowLeft'?-5:5));}
  if(e.key==='Home'||e.key==='End'){e.preventDefault();seekUtc(e.key==='Home'?fixes[0].t:fixes.at(-1).t);}
};
function insetRect() {
  const r = inset.getBoundingClientRect(), s = shell.getBoundingClientRect();
  return {left:r.left-s.left, top:r.top-s.top, width:r.width, height:r.height};
}
function setInsetGeometry(left,top,width=inset.offsetWidth,height=inset.offsetHeight) {
  const w = shell.clientWidth, h = Math.max(0, shell.clientHeight - root.querySelector('.dashboard').offsetHeight);
  if (!w || !h || !inset.offsetWidth || !inset.offsetHeight) return;
  width = clamp(width, Math.min(180,w), w); height = clamp(height, Math.min(120,h), h);
  inset.style.width = width + 'px'; inset.style.height = height + 'px';
  inset.style.left = clamp(left,0,Math.max(0,w-width)) + 'px';
  inset.style.top = clamp(top,0,Math.max(0,h-height)) + 'px';
  inset.style.right = 'auto';
}
let dragging;
$('inset-handle').onpointerdown=e=>{if(mode==='hud')return;const r=insetRect();dragging={x:e.clientX,y:e.clientY,left:r.left,top:r.top};$('inset-handle').setPointerCapture(e.pointerId);};
$('inset-handle').onpointermove=e=>{if(dragging)setInsetGeometry(dragging.left+e.clientX-dragging.x,dragging.top+e.clientY-dragging.y);};
$('inset-handle').onpointerup=$('inset-handle').onpointercancel=()=>dragging=null;
$('inset-handle').onkeydown=e=>{
  const delta={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[e.key];
  if(!delta||mode==='hud'||e.defaultPrevented||e.isComposing||e.keyCode===229||e.ctrlKey||e.metaKey||e.altKey)return;
  e.preventDefault();
  const r=insetRect(),[x,y]=delta;
  setInsetGeometry(r.left+(e.shiftKey?0:x),r.top+(e.shiftKey?0:y),r.width+(e.shiftKey?x:0),r.height+(e.shiftKey?y:0));
};
const clampInset=()=>{if(mode!=='hud'){const r=insetRect();setInsetGeometry(r.left,r.top);}};
const resizeObserver = new ResizeObserver(() => { clampInset(); map?.resize(); });
resizeObserver.observe(shell); resizeObserver.observe(inset); observers.push(resizeObserver);
const shortcuts = [
  ['Space','play','click'], ['m','mode','click'], ['s','swap','click'],
  ['c','follow','click'], ['h','heading','click'],
  ['u','mute','click'], ['f','fullscreen','click'], ['Escape','fullscreen','click'], ['t','takeoff','click'], ['l','landing','click'],
  [',','minus','click',true], ['.','plus','click',true], ['r','reset','click'],
  ['a','advanced','click'], ['o','opacity','focus'], ['k','seek','focus'], ['v','volume','focus'],
  ['q','quality','focus'], ['b','rate','focus'], ['p','profile','focus'], ['i','inset-handle','focus'],
].map(([key,id,activation,repeat=false])=>({key,element:$(id),activation,repeat}));
shortcuts.push({key:'d',element:shell,activation:'toggle-drop'});
for(const element of new Set(shortcuts.filter(shortcut=>shortcut.element!==shell).map(shortcut=>shortcut.element))) {
  const bindings=shortcuts.filter(shortcut=>shortcut.element===element);
  const label=element.title||element.getAttribute('aria-label')||element.labels?.[0]?.textContent.trim()||element.textContent.trim();
  element.title=`${label} (${bindings.map(({key,repeat})=>`${key.length===1?key.toUpperCase():key}${repeat?' / Shift for 1 s':''}`).join(' / ')})`;
  element.setAttribute('aria-keyshortcuts',bindings.map(({key,repeat})=>`${key}${repeat?` Shift+${key}`:''}`).join(' '));
  if(element.tagName==='BUTTON') {
    const key=bindings[0].key;
    const hint=document.createElement('kbd');
    hint.textContent=key.length===1?key.toUpperCase():key;
    hint.setAttribute('aria-hidden','true');
    element.firstChild.textContent+=' ';
    element.append(hint);
  }
}
shell.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!isFullscreen())return;
  const shortcut=shortcutForEvent(e,shortcuts);
  if(!shortcut)return;
  e.preventDefault();
  if(shortcut.activation==='toggle-drop')drop=!drop;
  else if(shortcut.activation==='focus')shortcut.element.focus();
  else if(shortcut.repeat&&e.shiftKey)shortcut.element.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));
  else shortcut.element.click();
}, {signal:uiController.signal});
function assertLive() { if (destroyed) throw new Error('Player is destroyed'); }
const api = {
  get ready() { return initialReady; },
  get state() { return playback ? {...playback.state, mode, mainView, sample:current ? {...current, position:[...current.position]} : null, mapReady:ready, advancedSync} : null; },
  load,
  selectQuality(id) { return playback?.selectQuality(id) ?? Promise.resolve({status: 'rejected', reason: 'no-flight'}); },
  updateQualities(loadId, catalogue) { return playback?.updateCatalogue(loadId, catalogue) ?? {status: 'rejected', reason: 'stale-load', message: 'The flight load is no longer current.'}; },
  play() { assertLive(); playback?.play(); },
  pause() { assertLive(); playback?.pause(); },
  seek(seconds) { assertLive(); seek(seconds); },
  landmark(landmark) {
    assertLive();
    if (!playback) return {status: 'no-flight'};
    const utc = landmarks[landmark];
    return utc === null ? {status: 'unavailable', landmark}
      : {status: 'available', landmark, elapsed: timeline.elapsedAtUtc(utc, nudge)};
  },
  seekLandmark(landmark) {
    const target = api.landmark(landmark);
    if (target.status !== 'available') return target;
    api.seek(target.elapsed);
    return {...target, status: 'applied'};
  },
  setRate(rate) { assertLive(); playback?.setRate(rate); },
  setAdvancedSync(on) { assertLive(); setAdvancedSync(on); },
  setNudge(seconds) { assertLive(); nudge = Number.isFinite(seconds) ? seconds : nudge; playback?.setNudge(nudge); updateSync(); },
  on(type, listener) {
    assertLive();
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener); events.addEventListener(type, listener);
    return () => api.off(type, listener);
  },
  off(type, listener) { events.removeEventListener(type, listener); listeners.get(type)?.delete(listener); },
  destroy() {
    if (destroyed) return;
    destroyed = true; ++generation;
    events.dispatchEvent(new CustomEvent('destroy', {detail:{}}));
    controller?.abort(); cancelAnimationFrame(raf);
    for (const observer of observers) observer.disconnect();
    if (isFullscreen()) document.exitFullscreen().catch(() => {});
    uiController.abort();
    for (const [type, entries] of listeners) for (const listener of entries) events.removeEventListener(type, listener);
    listeners.clear();
    clearSession('destroy'); root.replaceChildren(); host.remove();
  },
};
clearSession(); applyMode();
raf = requestAnimationFrame(frame);
const initialReady = options.manifest === undefined ? Promise.resolve(api) : load(options.manifest, {qualities: options.qualities, resolveSource: options.resolveSource});
// Keep ignored initialization failures from becoming unhandled rejections. ready still rejects.
initialReady.catch(() => {});
return api;
}
