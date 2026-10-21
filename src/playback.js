import {planCandidates, requestSource, safeMessage} from './sources.js';

export class Playback {
  constructor(timeline, {session, createMedia, removeMedia = () => {}, now = () => performance.now(), timers = globalThis,
    onChange = () => {}, onError = () => {}, onQuality = () => {}, onCatalogue = () => {}}) {
    Object.assign(this, {timeline, session, createMedia, removeMedia, now, timers, onChange, onError, onQuality, onCatalogue});
    this.elapsed = 0;
    this.nudge = 0;
    this.rate = 1;
    this.volume = 1;
    this.muted = false;
    this.playing = false;
    this.phase = 'paused';
    this.active = null;
    this.pending = null;
    this.requested = session.catalogue?.default ?? null;
    this.outcome = null;
    this.error = null;
    this.serial = 0;
    this.anchor = this.now();
    this.destroyed = false;
  }
  get media() { return this.active?.media ?? this.pending?.step?.slot?.media ?? null; }
  get quality() {
    const catalogue = this.session.catalogue;
    if (!catalogue || !this.timeline.clips.length) return null;
    const clip = this.timeline.locate(this.elapsed)?.index;
    let rendition = null;
    if (this.active?.option.mode === 'auto') {
      rendition = 'unknown';
      try {
        const value = this.active.attached?.rendition();
        if (value && typeof value.label === 'string') rendition = {label: safeMessage(value.label, 'unsupported')};
      } catch {}
    }
    return {revision: catalogue.revision, options: catalogue.options.filter(o => o.supported).map(({supported, delivery, ...o}) => ({
      ...o, delivery: {...delivery}, availability: clip === undefined ? null : catalogue.availability(clip, o.id),
    })), requested: this.requested, active: this.active?.lease.source.quality ?? null, rendition,
    pending: this.pending?.requested ?? null, outcome: this.outcome ? {...this.outcome} : null};
  }
  get state() {
    const found = this.timeline.locate(this.elapsed);
    return {elapsed: this.elapsed, utc: this.timeline.trackUtc(this.elapsed, this.nudge), origin: this.timeline.origin,
      ...this.timeline.bounds(this.nudge), playing: this.playing, phase: this.phase, rate: this.rate, nudge: this.nudge,
      clipIndex: found?.index ?? null, localTime: found?.localTime ?? null,
      mediaTime: this.media?.currentTime ?? null, readyState: this.media?.readyState ?? 0,
      load: this.session.load, quality: this.quality, error: this.error ? {...this.error} : null};
  }
  publish() { this.onChange(this.state); }
  identity(tx) {
    return {load: this.session.load, revision: tx.revision, transition: tx.id, request: tx.request,
      clip: tx.clip, requested: tx.requested};
  }
  qualityEvent(tx, status, reason = null, candidate = null) {
    this.onQuality({...this.identity(tx), status, reason, candidate, active: this.active?.lease.source.quality ?? null,
      pending: this.pending?.requested ?? null, quality: this.quality});
  }
  transaction(cause, acks = []) {
    return {id: `${this.session.load}:t${++this.serial}`, cause, revision: this.session.catalogue.revision,
      requested: this.requested, clip: this.timeline.locate(this.elapsed)?.index ?? null,
      request: null, requests: 0, queue: planCandidates(this.session.catalogue, this.requested), attempted: new Set(),
      failures: [], restored: false, step: null, acks};
  }
  finish(tx, result) {
    if (this.pending !== tx) return;
    tx.step?.cancel?.();
    tx.step = null;
    this.pending = null;
    this.anchor = this.now();
    const outcome = {...this.identity(tx), ...result};
    this.outcome = outcome;
    this.publish();
    this.qualityEvent(tx, outcome.status, outcome.reason);
    for (const ack of tx.acks) ack({...outcome});
  }
  cancel(reason) {
    const tx = this.pending;
    if (!tx) return;
    if (!tx.step?.slot || tx.step.slot !== this.active) tx.step?.controller?.abort();
    tx.step?.cancel?.();
    if (tx.step?.slot && tx.step.slot !== this.active) this.dispose(tx.step.slot);
    this.finish(tx, {status: 'cancelled', outcome: 'cancelled', active: this.active?.lease.source.quality ?? null, reason});
  }
  dispose(slot) {
    if (!slot || slot.disposed) return;
    slot.disposed = true;
    slot.controller.abort();
    slot.media.pause();
    try { slot.attached?.detach(); } catch {}
    slot.media.removeAttribute('src');
    slot.media.load();
    this.removeMedia(slot.media);
    slot.lease.release();
  }
  retireActive() {
    const slot = this.active;
    this.active = null;
    this.dispose(slot);
  }
  destroy(reason = 'destroy') {
    if (this.destroyed) return;
    this.destroyed = true;
    this.playing = false;
    this.retireActive();
    this.cancel(reason);
    this.onChange = this.onError = this.onQuality = this.onCatalogue = () => {};
  }
  seek(value) {
    if (!Number.isFinite(value) || this.destroyed) return;
    this.cancel('superseded');
    this.elapsed = this.timeline.clamp(value, this.nudge);
    const found = this.timeline.locate(this.elapsed);
    if (this.active?.clip !== found?.index) this.retireActive();
    this.error = null;
    this.anchor = this.now();
    if (!found) {
      this.phase = 'gap';
      if (this.elapsed >= this.timeline.bounds(this.nudge).end) this.playing = false;
      this.publish();
    } else this.begin('seek', this.active?.lease.source.quality === this.requested ? this.active : null);
  }
  selectQuality(id) {
    const catalogue = this.session.catalogue;
    if (this.destroyed || !catalogue || !this.timeline.clips.length) return Promise.resolve({status: 'rejected', reason: 'no-flight'});
    if (!catalogue.byId.get(id)?.supported) return Promise.resolve({status: 'rejected', reason: 'unknown-quality'});
    if (this.pending?.requested === id) return new Promise(ack => this.pending.acks.push(ack));
    this.captureMedia();
    this.cancel('superseded');
    this.requested = id;
    if (!this.timeline.locate(this.elapsed)) {
      const tx = this.transaction('select');
      this.pending = tx;
      let promise = new Promise(ack => tx.acks.push(ack));
      this.finish(tx, {status: 'deferred', outcome: 'deferred', active: null, reason: 'gap'});
      return promise;
    }
    if (this.active?.lease.source.quality === id) {
      if (this.playing && this.active.media.paused) return this.begin('resume', this.active);
      const tx = this.transaction('select');
      this.pending = tx;
      const promise = new Promise(ack => tx.acks.push(ack));
      this.phase = this.playing ? 'playing' : 'paused';
      this.finish(tx, {status: 'applied', outcome: 'applied', active: id, reason: this.error?.reason ?? null, playing: this.playing});
      return promise;
    }
    return this.begin(this.error ? 'retry' : 'select');
  }
  updateCatalogue(load, input) {
    if (this.destroyed || load !== this.session.load) return {status: 'rejected', reason: 'stale-load', message: 'The flight load is no longer current.'};
    let catalogue;
    try { catalogue = this.session.parseCatalogue(input); }
    catch { return {status: 'rejected', reason: 'invalid', message: 'Invalid quality catalogue.'}; }
    if (catalogue.revision <= (this.session.catalogue?.revision ?? -1)) return {status: 'rejected', reason: 'stale-revision', message: 'The catalogue revision must increase.'};
    this.captureMedia();
    const hadPending = !!this.pending, serial = this.serial;
    const removed = !catalogue.byId.has(this.requested);
    this.session.catalogue = catalogue;
    if (removed) this.requested = catalogue.default;
    this.cancel(removed ? 'removed' : 'superseded');
    if (this.destroyed || this.session.catalogue !== catalogue) return {status: 'updated'};
    const activeRemoved = this.active && !catalogue.byId.get(this.active.lease.source.quality)?.supported;
    if (this.serial === serial && (hadPending || removed || activeRemoved)) {
      if (this.timeline.locate(this.elapsed)) this.begin('catalogue', null, removed || activeRemoved ? 'removed' : null);
      else {
        const tx = this.transaction('catalogue'); this.pending = tx;
        this.finish(tx, {status: 'deferred', outcome: 'deferred', active: null, reason: 'gap'});
      }
    } else this.publish();
    if (!this.destroyed && this.session.catalogue === catalogue) this.onCatalogue({load: this.session.load, quality: this.quality});
    return {status: 'updated'};
  }
  begin(cause, reuse = null, reason = null) {
    if (this.destroyed) return Promise.resolve({status: 'rejected', reason: 'no-flight'});
    this.cancel('superseded');
    const tx = this.transaction(cause);
    tx.reason = reason ?? (cause === 'resume' ? this.outcome?.reason : null);
    this.pending = tx;
    const promise = new Promise(ack => tx.acks.push(ack));
    this.phase = 'loading';
    this.error = null;
    this.active?.media.pause();
    this.publish();
    if (this.pending === tx) this.qualityEvent(tx, 'pending', reason);
    if (this.pending === tx) this.run(tx, reuse);
    return promise;
  }
  async run(tx, reuse) {
    if (reuse) {
      const result = await this.prepare(tx, reuse, true);
      if (this.pending !== tx) return;
      if (result.status === 'ready') { this.commit(tx, reuse, result); return; }
      tx.step = null;
    }
    while (this.pending === tx && tx.queue.length) {
      const id = tx.queue.shift();
      if (tx.attempted.has(id)) continue;
      tx.attempted.add(id);
      const option = this.session.catalogue.byId.get(id);
      tx.request = `${tx.id}:r${++tx.requests}`;
      let result;
      if (!option?.supported) result = {status: 'unsupported'};
      else if (this.session.catalogue.availability(tx.clip, id) === 'unavailable') result = {status: 'unavailable'};
      else {
        const controller = new AbortController();
        tx.step = {kind: 'resolving', quality: id, controller};
        const found = this.timeline.locate(this.elapsed);
        result = await requestSource(this.session.resolve, {...this.identity(tx), quality: id, localTime: found.localTime,
          clip: {index: tx.clip, startUtc: found.clip.startUtc ?? new Date(found.clip.startUtcSeconds * 1000).toISOString(), durationSeconds: found.clip.durationSeconds}, signal: controller.signal},
        {controller, timeoutMs: this.session.timeouts.resolveMs, deliveries: this.session.deliveries, option, timers: this.timers, now: this.now});
        if (this.pending !== tx) { result.lease?.release(); return; }
        if (result.status === 'source') {
          const slot = this.createSlot(tx, result.lease, option, controller);
          result = await this.prepare(tx, slot, false);
          if (this.pending !== tx) { if (slot !== this.active) this.dispose(slot); return; }
          if (result.status === 'ready') { this.commit(tx, slot, result); return; }
          this.dispose(slot);
        }
      }
      if (this.pending !== tx) return;
      tx.step = null;
      const failure = {quality: id, kind: result.kind ?? 'source', reason: result.status, message: safeMessage(result.message, result.status), retryable: result.retryable ?? true};
      tx.failures.push(failure);
      this.publish();
      if (this.pending !== tx) return;
      this.qualityEvent(tx, 'candidate', failure.reason, id);
      if (this.pending !== tx) return;
      if (!tx.restored && this.active?.clip === tx.clip && this.session.catalogue.byId.get(this.active.lease.source.quality)?.supported) {
        tx.restored = true;
        const previous = this.active;
        const restored = await this.prepare(tx, previous, true);
        if (this.pending !== tx) return;
        if (restored.status === 'ready') {
          this.phase = restored.blocked || !this.playing ? 'paused' : 'playing';
          this.error = restored.blocked
            ? {kind: 'playback', reason: 'autoplay-blocked', message: safeMessage(null, 'autoplay-blocked'), retryable: true}
            : null;
          this.finish(tx, {status: 'failed', outcome: 'failed', active: previous.lease.source.quality,
            reason: failure.reason, message: failure.message, retryable: failure.retryable});
          return;
        }
        tx.attempted.add(previous.lease.source.quality);
        this.retireActive();
      }
    }
    if (this.pending !== tx) return;
    this.retireActive();
    this.playing = false;
    this.phase = 'error';
    const failure = tx.failures[0] ?? {kind: 'source', reason: 'unsupported', message: safeMessage(null, 'unsupported'), retryable: true};
    this.error = {kind: failure.kind, reason: failure.reason, message: failure.message, retryable: failure.retryable};
    this.finish(tx, {status: 'failed', outcome: 'failed', active: null, reason: failure.reason, message: failure.message, retryable: failure.retryable});
  }
  createSlot(tx, lease, option, controller) {
    const media = this.createMedia();
    const slot = {media, lease, option, controller, clip: tx.clip, attached: null, disposed: false};
    media.hidden = true;
    media.defaultPlaybackRate = this.rate;
    media.playbackRate = this.rate;
    media.volume = this.volume;
    media.muted = this.muted;
    const steady = () => !slot.disposed && this.active === slot && !this.pending;
    media.addEventListener('playing', () => {
      if (slot.disposed || !this.playing) { media.pause(); return; }
      if (steady() && this.phase !== 'error') { this.phase = 'playing'; this.publish(); }
    });
    media.addEventListener('timeupdate', () => { if (steady()) this.tick(); });
    media.addEventListener('waiting', () => {
      if (!steady() || !this.playing || this.phase === 'error') return;
      if (this.phase === 'playing') this.captureMedia();
      this.phase = 'buffering'; this.progressAt = this.now(); this.publish();
    });
    media.addEventListener('canplay', () => {
      if (!steady() || this.phase !== 'buffering' || !this.playing) return;
      if (media.paused) this.begin('resume', slot);
      else { this.phase = 'playing'; this.publish(); }
    });
    media.addEventListener('pause', () => {
      if (!steady() || !this.playing || media.ended || media.seeking) return;
      this.captureMedia(); this.playing = false; this.phase = 'paused'; this.publish();
    });
    media.addEventListener('ended', () => {
      if (!steady()) return;
      const clip = this.timeline.clips[slot.clip];
      this.seek(clip.startUtcSeconds + clip.durationSeconds - this.timeline.origin);
    });
    media.addEventListener('error', () => {
      if (steady()) this.activeFailure('media-failed');
      else if (this.active === slot && this.pending?.step?.slot !== slot) this.retireActive();
    });
    return slot;
  }
  prepare(tx, slot, restoring) {
    return new Promise(resolve => {
      const media = slot.media, source = slot.lease.source;
      const clip = this.timeline.clips[tx.clip];
      const target = source.mediaStartSeconds + this.elapsed - (clip.startUtcSeconds - this.timeline.origin);
      const deadline = this.now() + this.session.timeouts.readyMs;
      let finished = false, positioned = false, attached = restoring, starting = false, acknowledged = false, playTries = 0;
      const step = {kind: restoring ? 'restoring' : 'staging', slot, controller: slot.controller, cancel: () => finish({status: 'cancelled'})};
      tx.step = step;
      const current = () => this.pending === tx && tx.step === step && !slot.disposed;
      const finish = result => {
        if (finished) return;
        finished = true;
        this.timers.clearTimeout(timer);
        for (const event of ['loadedmetadata', 'canplay', 'seeked', 'playing']) media.removeEventListener(event, check);
        media.removeEventListener('error', error);
        if (result.status !== 'ready') {
          media.hidden = true; media.pause();
          if (this.active && this.active !== slot) this.active.media.hidden = false;
        }
        resolve(result);
      };
      const fail = reason => {
        if (!current() || finished) return;
        finish({status: reason, kind: 'media'});
        this.onError(safeMessage(null, reason), {...this.identity(tx), reason});
      };
      const error = () => fail('media-failed');
      const check = () => {
        if (!current() || finished) return;
        if (this.now() >= deadline) { fail('timeout'); return; }
        if (!attached || media.readyState < 1) return;
        if (!positioned) {
          if (Number.isFinite(media.duration) && media.duration < source.mediaStartSeconds + clip.durationSeconds) { fail('mapping-failed'); return; }
          positioned = true;
          try { media.currentTime = target; } catch { fail('mapping-failed'); return; }
        }
        if (media.seeking || media.readyState < 3) return;
        if (!(media.videoWidth > 0)) { fail('media-failed'); return; }
        if (!Number.isFinite(media.currentTime) || (step.kind !== 'starting' && Math.abs(media.currentTime - target) > .05)) { fail('mapping-failed'); return; }
        media.hidden = false;
        if (this.active && this.active !== slot) this.active.media.hidden = true;
        if (!this.playing) { media.pause(); finish({status: 'ready', playing: false}); return; }
        if (acknowledged && !media.paused) { finish({status: 'ready', playing: true}); return; }
        if (starting) return;
        starting = true; step.kind = 'starting'; ++playTries;
        const playPromise = slot.playPromise ?? Promise.resolve().then(() => current() && !finished && this.playing ? media.play() : undefined);
        slot.playPromise = playPromise;
        playPromise.then(() => {
          if (slot.playPromise === playPromise) slot.playPromise = null;
          starting = false;
          if (!current() || finished) { if (slot.disposed || !this.playing) media.pause(); return; }
          acknowledged = true;
          if (!this.playing || !media.paused) check();
        }, value => {
          if (slot.playPromise === playPromise) slot.playPromise = null;
          starting = false;
          if (!current() || finished) { if (slot.disposed || !this.playing) media.pause(); return; }
          if (!this.playing) { check(); return; }
          if (value?.name === 'NotAllowedError') {
            this.playing = false; media.pause();
            finish({status: 'ready', playing: false, blocked: true});
          } else if (value?.name === 'AbortError' && playTries < 2) check();
          else fail('media-failed');
        });
      };
      step.intentChanged = check;
      const timer = this.timers.setTimeout(() => fail('timeout'), this.session.timeouts.readyMs);
      timer?.unref?.();
      for (const event of ['loadedmetadata', 'canplay', 'seeked', 'playing']) media.addEventListener(event, check);
      media.addEventListener('error', error);
      if (restoring) check();
      else Promise.resolve().then(() => current() ? this.session.deliveries.attach(media, source, slot.option, slot.controller.signal) : null).then(value => {
        if (!current() || finished) { try { value?.detach(); } catch {} return; }
        slot.attached = value; attached = true; check();
      }, () => {
        if (!current() || finished) return;
        finish({status: 'unsupported'});
      });
    });
  }
  commit(tx, slot, result) {
    if (this.pending !== tx) return;
    const previous = this.active;
    this.active = slot;
    slot.media.hidden = false;
    this.phase = result.playing ? 'playing' : 'paused';
    this.error = result.blocked ? {kind: 'playback', reason: 'autoplay-blocked', message: safeMessage(null, 'autoplay-blocked'), retryable: true} : null;
    if (previous !== slot) this.dispose(previous);
    const active = slot.lease.source.quality;
    if (result.playing && tx.reason === 'autoplay-blocked') tx.reason = null;
    this.finish(tx, {status: 'applied', outcome: active === tx.requested ? 'applied' : 'fallback', active,
      reason: result.blocked ? 'autoplay-blocked' : tx.failures[0]?.reason ?? tx.reason ?? null, playing: result.playing});
  }
  activeFailure(reason) {
    this.captureMedia();
    this.playing = false;
    this.phase = 'error';
    this.retireActive();
    const tx = this.transaction('recover'); this.pending = tx;
    const message = safeMessage(null, reason);
    this.error = {kind: 'media', reason, message, retryable: true};
    this.finish(tx, {status: 'failed', outcome: 'failed', active: null, reason, message, retryable: true});
    this.onError(message, {...this.identity(tx), reason});
  }
  captureMedia() {
    if (this.pending || this.phase !== 'playing' || !this.active) return;
    const {media, lease, clip: index} = this.active, clip = this.timeline.clips[index];
    if (Number.isFinite(media.currentTime)) this.elapsed = clip.startUtcSeconds - this.timeline.origin + Math.max(0, Math.min(media.currentTime - lease.source.mediaStartSeconds, clip.durationSeconds));
  }
  tick() {
    const now = this.now();
    if (this.pending) { this.anchor = now; return; }
    if (this.phase === 'buffering' && now - this.progressAt > 30000) { this.activeFailure('timeout'); return; }
    if (!this.playing) {
      this.anchor = now;
      if (this.active?.option.mode === 'auto') this.publish();
      return;
    }
    if (this.phase === 'gap') {
      const next = this.timeline.clamp(this.elapsed + (now - this.anchor) / 1000 * this.rate, this.nudge);
      const upcoming = this.timeline.clips.find(c => c.startUtcSeconds - this.timeline.origin > this.elapsed);
      const boundary = upcoming?.startUtcSeconds - this.timeline.origin;
      this.anchor = now;
      if (upcoming && next >= boundary) { this.seek(boundary); return; }
      this.elapsed = next;
      if (next >= this.timeline.bounds(this.nudge).end) this.playing = false;
    } else if (this.phase === 'playing') {
      const clip = this.active && this.timeline.clips[this.active.clip];
      this.captureMedia();
      if (clip && this.elapsed >= clip.startUtcSeconds + clip.durationSeconds - this.timeline.origin) { this.seek(this.elapsed); return; }
    }
    this.anchor = now;
    this.publish();
  }
  play() {
    if (this.destroyed) return;
    if (this.pending) { this.playing = true; this.pending.step?.intentChanged?.(); this.publish(); return; }
    if (this.elapsed >= this.timeline.bounds(this.nudge).end) this.seek(this.timeline.bounds(this.nudge).start);
    if (this.playing) return;
    this.playing = true; this.anchor = this.now();
    if (this.active) this.begin('resume', this.active);
    else if (this.phase === 'error') this.begin('retry');
    this.publish();
  }
  pause() {
    this.tick(); this.playing = false;
    this.active?.media.pause();
    const slot = this.pending?.step?.slot;
    slot?.media.pause();
    this.pending?.step?.intentChanged?.();
    if (['playing', 'buffering'].includes(this.phase)) this.phase = 'paused';
    this.publish();
  }
  setRate(value) {
    if (!Number.isFinite(value) || value < .0625 || value > 16) return;
    this.tick(); this.rate = value;
    for (const slot of new Set([this.active, this.pending?.step?.slot])) if (slot) { slot.media.defaultPlaybackRate = value; slot.media.playbackRate = value; }
    this.publish();
  }
  setNudge(value) {
    if (!Number.isFinite(value)) return;
    this.tick(); this.nudge = value;
    const bounded = this.timeline.clamp(this.elapsed, value);
    if (bounded !== this.elapsed) this.seek(bounded);
    this.publish();
  }
  setAudio(volume, muted) {
    this.volume = volume; this.muted = muted;
    for (const slot of new Set([this.active, this.pending?.step?.slot])) if (slot) { slot.media.volume = volume; slot.media.muted = muted; }
  }
}
