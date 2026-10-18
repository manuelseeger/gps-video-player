// Angles are degrees. Camera headings stay continuous across full rotations.
export const normalizeHeading = angle => ((angle % 360) + 360) % 360;
export const headingDelta = (from, to) => normalizeHeading(to - from + 180) - 180;
export const smoothHeading = (from, to, dt) => from + headingDelta(from, to) * (1 - Math.exp(-dt * 1.5));
