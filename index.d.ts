export interface Player {
  readonly ready: Promise<Player>;
  readonly state: PlayerState | null;
  load(manifest: ManifestInput, overrides?: ResourceLoadingOptions): Promise<Player>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  setNudge(seconds: number): void;
  on<K extends keyof PlayerEventDetailMap>(type: K, listener: PlayerEventListener<K>): () => void;
  off<K extends keyof PlayerEventDetailMap>(type: K, listener: PlayerEventListener<K>): void;
  destroy(): void;
}

export interface PlayerOptions extends ResourceLoadingOptions {
  manifest?: ManifestInput;
  initialTime?: number;
  muted?: boolean;
  initialAttribution?: 'collapsed' | 'expanded';
  nonce?: string;
}

export interface ResourceLoadingOptions {
  baseUrl?: string;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  request?: {
    headers?: HeadersInit;
    credentials?: RequestCredentials;
  };
  authOrigin?: string;
}

export type ManifestInput = string | URL | Manifest;

export interface Manifest {
  version: 1;
  track: ManifestTrack;
  clips: ManifestClip[];
  metadata?: ManifestMetadata;
  map?: ManifestMap;
}

export type ManifestTrack = {startUtc: string} & (
  | {url: string; igc?: never}
  | {igc: string; url?: never}
);

export interface ManifestClip {
  url: string;
  startUtc: string;
  durationSeconds: number;
  mediaOffsetSeconds?: number;
  [key: string]: unknown;
}

export interface ManifestMetadata {
  title?: string;
  description?: string;
  timeZone?: string;
  [key: string]: unknown;
}

export interface ManifestMap {
  style?: string | MapStyle;
  terrain?: {source: string; exaggeration?: number};
}

export interface MapStyle {
  version: 8;
  sources: Record<string, unknown>;
  layers: unknown[];
  name?: string;
  metadata?: unknown;
  center?: number[];
  zoom?: number;
  bearing?: number;
  pitch?: number;
  light?: unknown;
  sky?: unknown;
  projection?: unknown;
  terrain?: unknown;
  glyphs?: string;
  sprite?: string | {id: string; url: string}[];
  transition?: unknown;
}

export type PlaybackPhase = 'paused' | 'gap' | 'loading' | 'playing' | 'buffering' | 'error';

export interface PlaybackState {
  elapsed: number;
  utc: number;
  origin: number;
  start: number;
  end: number;
  playing: boolean;
  phase: PlaybackPhase;
  rate: number;
  nudge: number;
  clipIndex: number | null;
  src: string | null;
  localTime: number | null;
  mediaTime: number | null;
  readyState: number;
}

export interface PlayerState extends PlaybackState {
  mode: 'map' | 'hud';
  mainView: 'video' | 'map';
  sample: TelemetrySample | null;
  mapReady: boolean;
}

export interface TelemetrySample {
  t: number;
  index: number;
  lat: number;
  lon: number;
  alt: number;
  vario: number;
  speed: number;
  heading: number;
  position: [number, number, number];
}

export interface PlayerEventDetailMap {
  load: {metadata: ManifestMetadata; state: PlaybackState};
  statechange: PlaybackState;
  mapready: Record<string, never>;
  error: {message: string};
  mediaerror: {message: string};
  maperror: {message: string | undefined};
  destroy: Record<string, never>;
}

export type PlayerEventListener<K extends keyof PlayerEventDetailMap> =
  (event: CustomEvent<PlayerEventDetailMap[K]>) => void;

export function createPlayer(container: Element, options?: PlayerOptions): Player;
