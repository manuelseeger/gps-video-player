export interface Player {
  readonly ready: Promise<Player>;
  readonly state: PlayerState | null;
  load(manifest: ManifestInput, overrides?: LoadOptions): Promise<Player>;
  selectQuality(id: QualityId): Promise<QualityAck>;
  updateQualities(load: LoadId, catalogue: QualityCatalogueInput): CatalogueAck;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  setNudge(seconds: number): void;
  on<K extends keyof PlayerEventDetailMap>(type: K, listener: PlayerEventListener<K>): () => void;
  off<K extends keyof PlayerEventDetailMap>(type: K, listener: PlayerEventListener<K>): void;
  destroy(): void;
}

export interface PlayerOptions extends LoadOptions {
  sourceTimeouts?: {resolveMs?: number; readyMs?: number};
  deliveries?: DeliveryAdapter[];
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

export type Manifest = ManifestV1 | ManifestV2;

export interface ManifestV1 {
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
  release?: () => void | Promise<void>;
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
  load: LoadId;
  quality: QualityState | null;
  error: PlaybackError | null;
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
  mediaerror: {message: string; load: LoadId; revision: number | null; transition: QualityTransitionId | null; request: SourceRequestId | null; clip: number | null; reason: QualityReason};
  qualitycatalogue: {load: LoadId; quality: QualityState | null};
  qualitychange: QualityChangeDetail;
  maperror: {message: string | undefined};
  destroy: Record<string, never>;
}

export type PlayerEventListener<K extends keyof PlayerEventDetailMap> =
  (event: CustomEvent<PlayerEventDetailMap[K]>) => void;

export function createPlayer(container: Element, options?: PlayerOptions): Player;

export type QualityId = string;
export type LoadId = string & {readonly __brand: 'LoadId'};
export type QualityTransitionId = string & {readonly __brand: 'QualityTransitionId'};
export type SourceRequestId = string & {readonly __brand: 'SourceRequestId'};
export type Availability = 'available' | 'unavailable' | 'unknown';

export interface QualityOptionInput {
  id: QualityId;
  label: string;
  mode?: 'fixed' | 'auto';
  delivery?: {kind: string; type?: string};
  width?: number;
  height?: number;
  bitrateKbps?: number;
  codecs?: string;
}

export interface QualityCatalogueInput {
  revision: number;
  options: QualityOptionInput[];
  default: QualityId;
  fallback: QualityId[];
  availability?: Array<Partial<Record<QualityId, Availability>>>;
}

export interface SourceRequest {
  load: LoadId;
  revision: number;
  transition: QualityTransitionId;
  clip: {index: number; startUtc: string; durationSeconds: number};
  quality: QualityId;
  localTime: number;
  request: SourceRequestId;
  signal: AbortSignal;
}

export interface SourceDescriptor {
  quality: QualityId;
  url: string;
  type?: string;
  delivery?: {kind: string; rendition?: string};
  mediaStartSeconds?: number;
  release?: () => void | Promise<void>;
}

export type SourceResolution =
  | {status: 'source'; source: SourceDescriptor}
  | {status: 'unavailable' | 'unsupported'}
  | {status: 'failed'; message: string; retryable: boolean};
export type SourceResolver = (request: SourceRequest) => SourceResolution | Promise<SourceResolution>;

export interface LoadOptions extends ResourceLoadingOptions {
  qualities?: QualityCatalogueInput;
  resolveSource?: SourceResolver;
}

export interface DeliveryAdapter {
  kind: string;
  adaptive: boolean;
  pinned: boolean;
  supports(type: string | undefined): boolean;
  attach(media: HTMLVideoElement, source: {url: string; type?: string; rendition: string | null}, signal: AbortSignal): Promise<AttachedDelivery>;
}

export interface AttachedDelivery {
  confirmedRendition?: string;
  rendition(): {label: string} | null;
  detach(): void;
}

export interface ManifestV2 {
  version: 2;
  track: ManifestTrack;
  qualities: Omit<QualityCatalogueInput, 'revision' | 'availability'> & {revision?: number};
  clips: Array<{
    startUtc: string;
    durationSeconds: number;
    sources?: Record<QualityId, Omit<SourceDescriptor, 'quality'>>;
  }>;
  metadata?: ManifestMetadata;
  map?: ManifestMap;
}

export type QualityReason = 'unavailable' | 'unsupported' | 'timeout' | 'resolver-failed' | 'invalid-source' |
  'media-failed' | 'mapping-failed' | 'autoplay-blocked' | 'superseded' | 'removed' | 'gap' | 'load' | 'destroy';
export interface QualityOptionView extends QualityOptionInput {
  mode: 'fixed' | 'auto';
  availability: Availability | null;
}
export interface PlaybackError {
  kind: 'media' | 'source' | 'playback';
  reason: QualityReason;
  message: string;
  retryable: boolean;
}
interface QualityIdentity {
  load: LoadId;
  revision: number;
  transition: QualityTransitionId;
  request: SourceRequestId | null;
  clip: number | null;
  requested: QualityId;
}
export type QualityOutcome = QualityIdentity & (
  | {status: 'applied'; outcome: 'applied' | 'fallback'; active: QualityId; reason: QualityReason | null; playing: boolean}
  | {status: 'deferred'; outcome: 'deferred'; active: null; reason: 'gap'}
  | {status: 'failed'; outcome: 'failed'; active: QualityId | null; reason: QualityReason; message: string; retryable: boolean}
  | {status: 'cancelled'; outcome: 'cancelled'; active: QualityId | null; reason: QualityReason}
);
export type QualityAck = QualityOutcome | {status: 'rejected'; reason: 'unknown-quality' | 'no-flight'};
export type CatalogueAck = {status: 'updated'} | {status: 'rejected'; reason: 'stale-load' | 'stale-revision' | 'invalid'; message: string};
export interface QualityState {
  revision: number;
  options: QualityOptionView[];
  requested: QualityId;
  active: QualityId | null;
  rendition: {label: string} | 'unknown' | null;
  pending: QualityId | null;
  outcome: QualityOutcome | null;
}
export interface QualityChangeDetail extends QualityIdentity {
  status: 'pending' | 'candidate' | QualityOutcome['status'];
  active: QualityId | null;
  pending: QualityId | null;
  reason: QualityReason | null;
  candidate: QualityId | null;
  quality: QualityState | null;
}
