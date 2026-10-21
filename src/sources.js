import {resourceUrl} from './manifest.js';

const reasons = {
  unavailable: 'This quality is not available for this clip.',
  unsupported: 'This video format or quality mode is not supported.',
  timeout: 'The video request timed out. Retry to continue.',
  'resolver-failed': 'The video service could not supply a source.',
  'invalid-source': 'The video service supplied an invalid source.',
  'media-failed': 'Video could not load or decode. Retry to continue.',
  'mapping-failed': 'Media is shorter than the clip trim range.',
  'autoplay-blocked': 'Playback was blocked. Press Play to continue.',
};

export function safeMessage(message, reason) {
  return typeof message === 'string' && message.length > 0 && message.length <= 160 &&
    !/[\x00-\x1f\x7f<>]|(?:https?:|blob:|www\.|bearer\b|token\b|signature\b|[?&]\w+=)/i.test(message)
    ? message : reasons[reason] ?? reasons['resolver-failed'];
}

function invalid() { throw new Error('Invalid quality catalogue'); }
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value);

export function createDeliveries(adapters = [], canPlayType = () => 'maybe') {
  const byKind = new Map();
  for (const adapter of adapters) {
    if (!adapter || !text(adapter.kind) || adapter.kind === 'progressive' || byKind.has(adapter.kind) ||
      typeof adapter.adaptive !== 'boolean' || typeof adapter.pinned !== 'boolean' ||
      typeof adapter.supports !== 'function' || typeof adapter.attach !== 'function') throw new Error('Invalid delivery adapter');
    byKind.set(adapter.kind, adapter);
  }
  const supports = (kind, type, mode) => {
    try {
      if (kind === 'progressive') return mode === 'fixed' && (!type || canPlayType(type) !== '');
      const adapter = byKind.get(kind);
      return !!adapter && (mode === 'auto' ? adapter.adaptive : adapter.pinned) && !!adapter.supports(type);
    } catch { return false; }
  };
  return {
    supportsOption: option => supports(option.delivery.kind, option.delivery.type, option.mode),
    supportsSource: (source, option) => source.delivery.kind === option.delivery.kind &&
      supports(source.delivery.kind, source.type ?? option.delivery.type, option.mode) &&
      (source.delivery.kind === 'progressive' || option.mode === 'auto' || text(source.delivery.rendition)),
    async attach(media, source, option, signal) {
      if (source.delivery.kind === 'progressive') {
        media.src = source.url;
        media.load();
        return {rendition: () => null, detach() {}};
      }
      const attached = await byKind.get(source.delivery.kind).attach(media, {
        url: source.url, type: source.type, rendition: option.mode === 'auto' ? null : source.delivery.rendition,
      }, signal);
      if (!attached || typeof attached.detach !== 'function' || typeof attached.rendition !== 'function' ||
        (option.mode === 'fixed' && attached.confirmedRendition !== source.delivery.rendition)) {
        try { attached?.detach?.(); } catch {}
        throw new Error('Unsupported delivery selection');
      }
      return attached;
    },
  };
}

export function parseCatalogue(input, {clipCount, deliveries}) {
  if (!record(input) || !Number.isSafeInteger(input.revision) || input.revision < 0 || !Array.isArray(input.options) || !input.options.length) invalid();
  const byId = new Map();
  const options = input.options.map(value => {
    if (!record(value) || !text(value.id) || !text(value.label) || byId.has(value.id)) invalid();
    const mode = value.mode ?? 'fixed', delivery = value.delivery ?? {kind: 'progressive'};
    if (!['fixed', 'auto'].includes(mode) || !record(delivery) || !text(delivery.kind) ||
      (delivery.type !== undefined && !text(delivery.type))) invalid();
    const option = {id: value.id, label: value.label, mode, delivery: {kind: delivery.kind, ...(delivery.type === undefined ? {} : {type: delivery.type})}};
    for (const key of ['width', 'height', 'bitrateKbps']) {
      if (value[key] !== undefined) {
        if (!Number.isFinite(value[key]) || value[key] <= 0) invalid();
        option[key] = value[key];
      }
    }
    if (value.codecs !== undefined) {
      if (!text(value.codecs)) invalid();
      option.codecs = value.codecs;
    }
    option.supported = deliveries.supportsOption(option);
    byId.set(option.id, option);
    return option;
  });
  if (!byId.has(input.default) || !Array.isArray(input.fallback) || new Set(input.fallback).size !== input.fallback.length || input.fallback.some(id => !byId.has(id))) invalid();
  const availability = input.availability ?? [];
  if (!Array.isArray(availability) || availability.length > clipCount) invalid();
  const rows = availability.map(row => {
    if (!record(row) || Object.entries(row).some(([id, value]) => !byId.has(id) || !['available', 'unavailable', 'unknown'].includes(value))) invalid();
    return {...row};
  });
  return {revision: input.revision, options, byId, default: input.default, fallback: [...input.fallback],
    availability: (clip, id) => rows[clip] && Object.hasOwn(rows[clip], id) ? rows[clip][id] : 'unknown'};
}

export function planCandidates(catalogue, requested) {
  return [...new Set([requested, ...catalogue.fallback])];
}

export function staticResolver(sources, owners = []) {
  return request => {
    const row = sources[request.clip.index];
    const source = row && Object.hasOwn(row, request.quality) ? row[request.quality] : null;
    const owner = owners[request.clip.index]?.sources?.[request.quality] ?? owners[request.clip.index] ?? source;
    const release = source?.release ?? owner?.release;
    return source ? {status: 'source', source: {...source, quality: request.quality,
      ...(typeof release === 'function' ? {release: release.bind(owner)} : {})}} : {status: 'unavailable'};
  };
}

export class Lease {
  constructor(source) { this.source = source; this.released = false; }
  release() {
    if (this.released) return;
    this.released = true;
    try { Promise.resolve(this.source?.release?.()).catch(() => {}); } catch {}
  }
}

export function requestSource(resolve, request, {controller, timeoutMs, deliveries, option, timers = globalThis, now = () => performance.now()}) {
  const deadline = now() + timeoutMs;
  return new Promise(done => {
    let settled = false;
    const finish = result => {
      if (settled) { result.lease?.release(); return; }
      settled = true;
      timers.clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      done(result);
    };
    const abort = () => finish({status: 'cancelled'});
    const timer = timers.setTimeout(() => { finish({status: 'timeout'}); controller.abort(); }, timeoutMs);
    timer?.unref?.();
    request.signal.addEventListener('abort', abort, {once: true});
    if (request.signal.aborted) { abort(); return; }
    Promise.resolve().then(() => request.signal.aborted ? {status: 'cancelled'} : resolve(request)).then(value => {
      if (!settled && now() >= deadline) { finish({status: 'timeout'}); controller.abort(); }
      if (value?.source && typeof value.source === 'object') {
        const lease = new Lease(value.source);
        if (settled || request.signal.aborted) { lease.release(); return; }
        try {
          const source = value.source;
          if (value.status !== 'source' || source.quality !== request.quality ||
            (source.release !== undefined && typeof source.release !== 'function') ||
            (source.type !== undefined && !text(source.type)) ||
            (source.delivery !== undefined && (!record(source.delivery) || !text(source.delivery.kind)))) throw new Error();
          const url = resourceUrl(source.url, undefined, {media: true});
          const offset = source.mediaStartSeconds ?? 0;
          if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(offset + request.clip.durationSeconds) ||
            (url.startsWith('blob:') && typeof source.release !== 'function')) throw new Error();
          lease.source = {quality: source.quality, url, type: source.type, mediaStartSeconds: offset,
            delivery: source.delivery ? {...source.delivery} : {kind: 'progressive'}, release: source.release?.bind(source)};
          if (!deliveries.supportsSource(lease.source, option)) { lease.release(); finish({status: 'unsupported'}); return; }
          finish({status: 'source', lease});
        } catch { lease.release(); finish({status: 'invalid-source'}); }
      } else if (['unavailable', 'unsupported'].includes(value?.status)) finish({status: value.status});
      else if (value?.status === 'failed') finish({status: 'resolver-failed', message: safeMessage(value.message, 'resolver-failed'), retryable: value.retryable === true});
      else finish({status: 'invalid-source'});
    }, () => {
      if (!settled && now() >= deadline) { finish({status: 'timeout'}); controller.abort(); }
      else finish({status: 'resolver-failed', message: reasons['resolver-failed'], retryable: true});
    }).catch(() => finish({status: 'invalid-source'}));
  });
}
