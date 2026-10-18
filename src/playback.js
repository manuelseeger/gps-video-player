// Each source/seek owns a media element. Retired elements cannot publish events
// or resolve play promises into the current playback session.
export class Playback {
  constructor(timeline, {createMedia, clearMedia, now = () => performance.now(), onChange = () => {}, onError = () => {}}) {
    Object.assign(this, {timeline, createMedia, clearMedia, now, onChange, onError});
    this.elapsed = 0;
    this.nudge = 0;
    this.rate = 1;
    this.volume = 1;
    this.muted = false;
    this.playing = false; // User intent, including while a clip buffers.
    this.phase = 'paused';
    this.media = null;
    this.session = 0;
    this.anchor = this.now();
  }
  get state() {
    const found = this.timeline.locate(this.elapsed);
    return {elapsed: this.elapsed, utc: this.timeline.trackUtc(this.elapsed, this.nudge), origin: this.timeline.origin,
      ...this.timeline.bounds(this.nudge), playing: this.playing, phase: this.phase, rate: this.rate, nudge: this.nudge,
      clipIndex: found?.index ?? null, src: found?.clip.src ?? null, localTime: found?.localTime ?? null,
      mediaTime: this.media?.currentTime ?? null, readyState: this.media?.readyState ?? 0};
  }
  publish() { this.onChange(this.state); }
  retire() {
    ++this.session;
    if (this.media) {
      this.media.pause();
      this.media.removeAttribute('src');
      this.media.load();
      this.media = null;
    }
    this.clearMedia();
    this.requestPlay = null;
    this.fail = null;
  }
  destroy() {
    this.playing = false;
    this.retire();
    this.onChange = this.onError = () => {};
  }
  seek(value) {
    if (!Number.isFinite(value)) return;
    this.retire();
    this.elapsed = this.timeline.clamp(value, this.nudge);
    this.anchor = this.now();
    const found = this.timeline.locate(this.elapsed);
    if (!found) {
      this.phase = 'gap';
      if (this.elapsed >= this.timeline.bounds(this.nudge).end) this.playing = false;
      this.publish();
      return;
    }
    const token = this.session;
    const media = this.createMedia(found.clip);
    this.media = media;
    media.hidden = true;
    media.defaultPlaybackRate = this.rate;
    media.playbackRate = this.rate;
    media.volume = this.volume;
    media.muted = this.muted;
    this.phase = 'loading';
    this.progressAt = this.now();
    let positioned = false, pendingPlay = false;
    const active = () => token === this.session && this.media === media;
    const fail = error => {
      if (!active()) return;
      if (error?.name === 'AbortError') return;
      this.playing = false;
      this.phase = 'error';
      media.pause();
      media.hidden = true;
      this.onError(error?.message || 'Clip could not load. Check the manifest, media URL, and H.264 support.');
      this.publish();
    };
    this.fail = fail;
    const requestPlay = () => {
      if (!active() || !positioned || media.seeking || media.readyState < 3 || !this.playing || pendingPlay) return;
      pendingPlay = true;
      Promise.resolve(media.play()).then(() => {
        pendingPlay = false;
        if (!active()) { media.pause(); return; }
        if (!this.playing) media.pause();
        else if (media.paused) requestPlay();
      }, error => {
        pendingPlay = false;
        if (!active() || !this.playing) return;
        if (error?.name === 'AbortError') requestPlay();
        else fail(error);
      });
    };
    this.requestPlay = requestPlay;
    const ready = () => {
      if (!active() || this.phase === 'error' || !positioned || media.seeking || media.readyState < 3) return;
      media.hidden = false;
      if (!this.playing) this.phase = 'paused';
      else if (!media.paused) this.phase = 'playing';
      requestPlay();
      this.publish();
    };
    media.addEventListener('loadedmetadata', () => {
      if (!active()) return;
      if (Number.isFinite(media.duration) && media.duration + 0.5 < (found.clip.mediaOffsetSeconds ?? 0) + found.clip.durationSeconds) {
        this.onError('Media is shorter than the clip trim range in the manifest.');
      }
      // Clip durations are manifest values. Actual media time is the clock.
      const target = found.localTime + (found.clip.mediaOffsetSeconds ?? 0);
      media.currentTime = Math.min(target, Number.isFinite(media.duration) ? Math.max(0, media.duration - 0.001) : target);
      positioned = true;
      ready();
    });
    for (const event of ['canplay', 'seeked']) media.addEventListener(event, ready);
    media.addEventListener('playing', () => {
      if (!active()) { media.pause(); return; }
      if (!this.playing || this.phase === 'error') { media.pause(); return; }
      ready();
    });
    // rAF is suspended in hidden tabs. Media events still drive trim and clip transitions.
    media.addEventListener('timeupdate', () => { if (active()) this.tick(); });
    media.addEventListener('waiting', () => {
      if (!active() || !this.playing || this.phase === 'error') return;
      if (this.phase === 'playing') this.captureMedia();
      this.phase = 'buffering';
      this.progressAt = this.now();
      this.publish();
    });
    media.addEventListener('pause', () => {
      if (!active() || !this.playing || media.ended || media.seeking) return;
      this.captureMedia();
      this.playing = false;
      this.phase = 'paused';
      this.publish();
    });
    media.addEventListener('ended', () => {
      if (!active()) return;
      this.seek(found.clip.startUtcSeconds + found.clip.durationSeconds - this.timeline.origin);
    });
    media.addEventListener('error', () => fail(media.error));
    media.src = found.clip.src;
    media.load();
    this.publish();
  }
  captureMedia() {
    const found = this.timeline.locate(this.elapsed);
    if (this.media && found && Number.isFinite(this.media.currentTime)) {
      this.elapsed = found.clip.startUtcSeconds - this.timeline.origin + Math.max(0, Math.min(this.media.currentTime - (found.clip.mediaOffsetSeconds ?? 0), found.clip.durationSeconds));
    }
  }
  tick() {
    const now = this.now();
    if (['loading', 'buffering'].includes(this.phase) && now - this.progressAt > 30000) {
      this.fail?.(new Error('Video load stalled. Press Play to retry.'));
      return;
    }
    if (!this.playing) { this.anchor = now; return; }
    if (this.phase === 'gap') {
      const next = this.timeline.clamp(this.elapsed + (now - this.anchor) / 1000 * this.rate, this.nudge);
      // Do not skip a whole clip when a background tab's clock advances.
      const upcoming = this.timeline.clips.find(c => c.startUtcSeconds - this.timeline.origin > this.elapsed);
      const boundary = upcoming?.startUtcSeconds - this.timeline.origin;
      this.anchor = now;
      if (upcoming && next >= boundary) { this.seek(boundary); return; }
      this.elapsed = next;
      if (next >= this.timeline.bounds(this.nudge).end) this.playing = false;
    } else if (this.phase === 'playing') {
      const found = this.timeline.locate(this.elapsed);
      this.captureMedia();
      if (found && this.elapsed >= found.clip.startUtcSeconds + found.clip.durationSeconds - this.timeline.origin) {
        this.seek(this.elapsed);
        return;
      }
    }
    this.anchor = now;
    this.publish();
  }
  play() {
    if (this.playing) return;
    if (this.phase === 'error') this.seek(this.elapsed);
    if (this.elapsed >= this.timeline.bounds(this.nudge).end) this.seek(this.timeline.bounds(this.nudge).start);
    this.playing = true;
    this.anchor = this.now();
    this.requestPlay?.();
    this.publish();
  }
  pause() {
    this.tick();
    this.playing = false;
    this.media?.pause();
    if (['playing', 'buffering'].includes(this.phase)) this.phase = 'paused';
    this.publish();
  }
  setRate(value) {
    if (!Number.isFinite(value) || value < 0.0625 || value > 16) return;
    this.tick();
    this.rate = value;
    if (this.media) { this.media.defaultPlaybackRate = value; this.media.playbackRate = value; }
    this.publish();
  }
  setNudge(value) {
    if (!Number.isFinite(value)) return;
    this.tick();
    this.nudge = value;
    const bounded = this.timeline.clamp(this.elapsed, value);
    if (bounded !== this.elapsed) this.seek(bounded);
    this.publish();
  }
  setAudio(volume, muted) {
    this.volume = volume;
    this.muted = muted;
    if (this.media) { this.media.volume = volume; this.media.muted = muted; }
  }
}
