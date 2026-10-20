import {clamp} from './flight.js';

export class Timeline {
  constructor(manifest, flightStart, flightEnd) {
    this.clips = manifest.clips;
    if (!Number.isFinite(flightStart) || !Number.isFinite(flightEnd) || flightEnd < flightStart) throw new Error('Invalid flight extent');
    this.origin = this.clips[0]?.startUtcSeconds ?? flightStart;
    this.flightStart = flightStart;
    this.flightEnd = flightEnd;
    this.videoEnd = this.clips.length ? this.clips.at(-1).startUtcSeconds + this.clips.at(-1).durationSeconds - this.origin : 0;
  }
  coverage(nudge = 0) {
    const spans = [];
    for (const clip of this.clips) {
      const start = Math.max(this.flightStart, clip.startUtcSeconds + nudge);
      const end = Math.min(this.flightEnd, clip.startUtcSeconds + clip.durationSeconds + nudge);
      if (end <= start) continue;
      const previous = spans.at(-1);
      if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
      else spans.push({start, end});
    }
    return spans;
  }
  bounds(nudge = 0) {
    return {start: Math.min(0, this.flightStart - this.origin - nudge), end: Math.max(this.videoEnd, this.flightEnd - this.origin - nudge)};
  }
  clamp(elapsed, nudge = 0) {
    const {start, end} = this.bounds(nudge);
    return clamp(elapsed, start, end);
  }
  trackUtc(elapsed, nudge = 0) { return this.origin + elapsed + nudge; }
  elapsedAtUtc(utc, nudge = 0) { return utc - this.origin - nudge; }
  locate(elapsed) {
    // Compare on the elapsed axis: adding the origin can round below a boundary.
    const index = this.clips.findIndex(c => elapsed >= c.startUtcSeconds - this.origin && elapsed < c.startUtcSeconds + c.durationSeconds - this.origin);
    return index < 0 ? null : {index, clip: this.clips[index], localTime: elapsed - (this.clips[index].startUtcSeconds - this.origin)};
  }
}
