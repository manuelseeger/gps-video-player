import {normalizeHeading, headingDelta} from './heading.js';

export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const rad = Math.PI / 180;
export function distance(a, b) {
  const dlat = (b.lat - a.lat) * rad, dlon = (b.lon - a.lon) * rad;
  const h = clamp(Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2, 0, 1);
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function bearing(a, b) {
  const dl = (b.lon - a.lon) * rad;
  return normalizeHeading(Math.atan2(Math.sin(dl) * Math.cos(b.lat * rad), Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dl)) / rad);
}
export function parseIGC(text) {
  let day = 0, previous = -1;
  const fixes = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^B\d{6}\d{7}[NS]\d{8}[EW]A/.test(line)) continue;
    const hour = +line.slice(1, 3), minute = +line.slice(3, 5), second = +line.slice(5, 7);
    if (hour > 23 || minute > 59 || second > 59) continue;
    let t = hour * 3600 + minute * 60 + second;
    const lat = (+line.slice(7, 9) + +line.slice(9, 14) / 60000) * (line[14] === 'S' ? -1 : 1);
    const lon = (+line.slice(15, 18) + +line.slice(18, 23) / 60000) * (line[23] === 'W' ? -1 : 1);
    if (+line.slice(9, 14) >= 60000 || +line.slice(18, 23) >= 60000 || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !/^-?\d{4,5}$/.test(line.slice(30, 35))) continue;
    const alt = +line.slice(30, 35); // GPS altitude, metres MSL.
    if (previous >= 0 && t + day < previous - 43200) day += 86400;
    t += day;
    if (t <= previous) continue;
    if ([t, lat, lon, alt].every(Number.isFinite)) { fixes.push({t, lat, lon, alt}); previous = t; }
  }
  if (fixes.length < 2) throw new Error('IGC has fewer than two valid GPS fixes');
  // Centered five-second regression: less noisy than one-second altitude differences.
  fixes.forEach((p, i) => {
    const window = fixes.slice(Math.max(0, i - 2), Math.min(fixes.length, i + 3));
    const mt = window.reduce((s, f) => s + f.t, 0) / window.length;
    const ma = window.reduce((s, f) => s + f.alt, 0) / window.length;
    p.vario = window.reduce((s, f) => s + (f.t - mt) * (f.alt - ma), 0) / (window.reduce((s, f) => s + (f.t - mt) ** 2, 0) || 1);
    const a = fixes[Math.max(0, i - 2)], b = fixes[Math.min(fixes.length - 1, i + 2)];
    p.speed = distance(a, b) / (b.t - a.t || 1);
    p.heading = bearing(a, b);
    p.position = [p.lon, p.lat, p.alt];
  });
  return fixes;
}
export function sample(fixes, t) {
  t = clamp(t, fixes[0].t, fixes.at(-1).t);
  let lo = 0, hi = fixes.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fixes[mid].t <= t) lo = mid; else hi = mid; }
  const a = fixes[lo], b = fixes[hi], f = (t - a.t) / (b.t - a.t);
  const p = {t, index: lo};
  for (const key of ['lat', 'lon', 'alt', 'vario', 'speed']) p[key] = a[key] + (b[key] - a[key]) * f;
  p.heading = normalizeHeading(a.heading + headingDelta(a.heading, b.heading) * f);
  p.position = [p.lon, p.lat, p.alt];
  return p;
}
const stops = [[-3, [38, 112, 255]], [-1.5, [22, 202, 244]], [0, [83, 225, 177]], [1.5, [255, 202, 54]], [3, [255, 57, 54]]];
export function varioColor(v, alpha = 255) {
  v = clamp(v, -3, 3);
  const i = Math.min(3, Math.floor((v + 3) / 1.5)), a = stops[i], b = stops[i + 1], f = (v - a[0]) / (b[0] - a[0]);
  return [...a[1].map((c, j) => Math.round(c + (b[1][j] - c) * f)), alpha];
}
export function utc(t, decimals = 0) { return new Date(Math.round(t * 1000)).toISOString().slice(11, decimals ? 20 + decimals : 19); }
