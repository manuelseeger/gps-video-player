import {createPlayer} from 'gps-video-player';
import type {
  Manifest, ManifestTrack, ManifestClip, ManifestMetadata, ManifestMap, MapStyle,
  Player, PlayerOptions, ResourceLoadingOptions, PlaybackState, PlayerState,
  TelemetrySample, PlaybackPhase, PlayerEventDetailMap, PlayerEventListener,
  QualityCatalogueInput, QualityAck, LoadId, QualityState, ManifestV2, DeliveryAdapter, SourceResolver,
} from 'gps-video-player';

function expectType<T>(value: T): void { void value; }

const clip: ManifestClip = {url: './video.mp4', startUtc: '2030-01-01T00:00:00Z', durationSeconds: 10, mediaOffsetSeconds: 1, camera: 'front'};
const track: ManifestTrack = {igc: 'IGC text', startUtc: clip.startUtc};
const metadata: ManifestMetadata = {title: 'Flight', description: 'Test', timeZone: 'UTC', custom: 42};
const style: MapStyle = {
  version: 8,
  sources: {dem: {type: 'raster-dem', tiles: ['https://example.com/{z}/{x}/{y}']}},
  layers: [{id: 'background', type: 'background', paint: {'background-color': '#000'}}],
  sky: {'sky-color': '#fff'},
};
const map: ManifestMap = {style, terrain: {source: 'dem', exaggeration: 1}};
const manifest: Manifest = {version: 1, track, clips: [clip], metadata, map};
const remote: Manifest = {version: 1, track: {url: './flight.igc', startUtc: clip.startUtc}, clips: []};
const resources: ResourceLoadingOptions = {
  baseUrl: 'https://example.com/manifest.json',
  fetch: (input, init) => fetch(input, init),
  request: {headers: new Headers({Authorization: 'token'}), credentials: 'include'},
  authOrigin: 'https://example.com',
};
const options: PlayerOptions = {...resources, manifest, initialTime: 3, muted: true, advancedSync: true, nonce: 'nonce'};
const collapsed: PlayerOptions = {initialAttribution: 'collapsed'};
const expanded: PlayerOptions = {initialAttribution: 'expanded'};
void [collapsed, expanded];
const player: Player = createPlayer(document.createElement('div'), options);
expectType<Promise<Player>>(player.ready);
expectType<Promise<Player>>(player.load(manifest, resources));
expectType<Promise<Player>>(player.load('https://example.com/manifest.json'));
expectType<Promise<Player>>(player.load(new URL('https://example.com/manifest.json')));
expectType<Promise<Player>>(player.load(remote));
expectType<void>(player.play());
expectType<void>(player.pause());
expectType<void>(player.seek(2));
expectType<void>(player.setRate(0.75));
expectType<void>(player.setNudge(-1));
expectType<void>(player.setAdvancedSync(true));
expectType<PlayerState | null>(player.state);
if (player.state) {
  const state: PlayerState = player.state;
  expectType<PlaybackState>(state);
  expectType<'map' | 'hud'>(state.mode);
  expectType<'map' | 'video'>(state.mainView);
  expectType<boolean>(state.mapReady);
  expectType<TelemetrySample | null>(state.sample);
  if (state.sample) {
    const sample = state.sample;
    expectType<[number, number, number]>(sample.position);
    for (const value of [sample.t, sample.index, sample.lat, sample.lon, sample.alt, sample.vario, sample.speed, sample.heading]) expectType<number>(value);
  }
  // @ts-expect-error
  expectType<number>(state.clipIndex);
  // @ts-expect-error
  expectType<number>(state.localTime);
  // @ts-expect-error
  expectType<number>(state.mediaTime);
  // @ts-expect-error
  expectType<string>(state.src);
}
const onState: PlayerEventListener<'statechange'> = event => {
  const state: PlaybackState = event.detail;
  expectType<PlayerEventDetailMap['statechange']>(state);
  expectType<PlaybackPhase>(state.phase);
  for (const value of [state.elapsed, state.utc, state.origin, state.start, state.end, state.rate, state.nudge, state.readyState]) expectType<number>(value);
  expectType<boolean>(state.playing);
  expectType<number | null>(state.clipIndex);
  // @ts-expect-error
  state.src;
  expectType<LoadId>(state.load);
  expectType<QualityState | null>(state.quality);
  expectType<number | null>(state.localTime);
  expectType<number | null>(state.mediaTime);
  const phases: Record<PlaybackPhase, true> = {paused: true, gap: true, loading: true, playing: true, buffering: true, error: true};
  expectType<true>(phases[state.phase]);
  // @ts-expect-error
  state.mapReady;
  // @ts-expect-error
  state.sample;
};
const unsubscribe: () => void = player.on('statechange', onState);
player.off('statechange', onState);
unsubscribe();
player.on('load', event => {
  expectType<ManifestMetadata>(event.detail.metadata);
  expectType<PlaybackState>(event.detail.state);
  // @ts-expect-error
  event.detail.state.mode;
});
player.on('error', event => expectType<string>(event.detail.message));
player.on('mediaerror', event => expectType<string>(event.detail.message));
player.on('maperror', event => {
  expectType<string | undefined>(event.detail.message);
  // @ts-expect-error
  expectType<string>(event.detail.message);
});
player.on('mapready', event => expectType<Record<string, never>>(event.detail));
player.on('destroy', event => expectType<Record<string, never>>(event.detail));
expectType<void>(player.destroy());

// @ts-expect-error
const badVersion: Manifest = {...manifest, version: 2};
// @ts-expect-error
const bothSources: ManifestTrack = {url: './track.igc', igc: 'text', startUtc: clip.startUtc};
// @ts-expect-error
const noSource: ManifestTrack = {startUtc: clip.startUtc};
// @ts-expect-error
const noDuration: ManifestClip = {url: './clip.mp4', startUtc: clip.startUtc};
// @ts-expect-error
const badClip: ManifestClip = {...clip, url: new URL('https://example.com')};
// @ts-expect-error
const noClips: Manifest = {version: 1, track};
// @ts-expect-error
const badMap: ManifestMap = {terrain: {exaggeration: 1}};
// @ts-expect-error
const badPhase: PlaybackPhase = 'ready';
// @ts-expect-error
createPlayer(null);
// @ts-expect-error
createPlayer(document.body, {autoplay: true});
// @ts-expect-error
createPlayer(document.body, {initialAttribution: true});
// @ts-expect-error
player.load(manifest, {muted: false});
// @ts-expect-error
player.seek('2');
// @ts-expect-error
player.on('ready', () => {});
// @ts-expect-error
player.on('load', onState);
// @ts-expect-error
player.off('load', onState);
// @ts-expect-error
player.ready = Promise.resolve(player);
// @ts-expect-error
player.state = null;
// @ts-expect-error
new Player();
void [badVersion, bothSources, noSource, noDuration, badClip, noClips, badMap, badPhase];

const qualities: QualityCatalogueInput = {
  revision: 1, options: [{id: 'saver', label: 'Data saver'}, {id: 'auto', label: 'Auto', mode: 'auto', delivery: {kind: 'provider'}}],
  default: 'saver', fallback: ['saver'], availability: [{auto: 'unknown'}],
};
const v2: ManifestV2 = {version: 2, track, qualities, clips: [{startUtc: clip.startUtc, durationSeconds: 10, sources: {
  saver: {url: './anything', mediaStartSeconds: 2, type: 'video/webm'},
}}]};
const resolver: SourceResolver = async request => {
  expectType<LoadId>(request.load);
  expectType<AbortSignal>(request.signal);
  expectType<number>(request.localTime);
  expectType<number>(request.clip.index);
  return {status: 'source', source: {quality: request.quality, url: 'https://media.example/source', release: async () => {}}};
};
const adapter: DeliveryAdapter = {kind: 'provider', adaptive: true, pinned: true, supports: () => true,
  async attach(media, source, signal) {
    expectType<HTMLVideoElement>(media); expectType<AbortSignal>(signal);
    return {...(source.rendition === null ? {} : {confirmedRendition: source.rendition}), rendition: () => null, detach() {}};
  }};
const qualityPlayer = createPlayer(document.body, {manifest: v2, qualities, resolveSource: resolver, deliveries: [adapter], sourceTimeouts: {resolveMs: 1000}});
player.load(v2, {qualities, resolveSource: resolver});
expectType<Promise<QualityAck>>(player.selectQuality('saver'));
player.selectQuality('auto').then(ack => {
  if (ack.status === 'applied') { expectType<string>(ack.active); expectType<boolean>(ack.playing); }
  if (ack.status === 'failed') { expectType<string>(ack.message); expectType<boolean>(ack.retryable); }
  if (ack.status === 'cancelled') expectType<string>(ack.reason);
});
if (qualityPlayer.state) qualityPlayer.updateQualities(qualityPlayer.state.load, {...qualities, revision: 2});
player.on('qualitycatalogue', event => expectType<QualityState | null>(event.detail.quality));
player.on('qualitychange', event => { expectType<LoadId>(event.detail.load); expectType<number>(event.detail.revision); });
// @ts-expect-error
player.updateQualities('another-flight', qualities);
// @ts-expect-error
const badMode: QualityCatalogueInput = {...qualities, options: [{id: 'x', label: 'X', mode: 'best'}]};
// @ts-expect-error
const badResolution: SourceResolver = () => ({status: 'source', source: {url: 'https://example.com'}});
// @ts-expect-error
const unconfirmed: DeliveryAdapter = {kind: 'provider', adaptive: true, supports: () => true, attach: adapter.attach};
void [badMode, badResolution, unconfirmed];
