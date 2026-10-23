export function detectLandmarks(fixes) {
  let run = null, previous = null;
  let takeoff = null, landing = null;
  for (const {t, speed} of fixes) {
    const kind = speed < 4 ? 'ground' : speed >= 8 ? 'airborne' : null;
    if (kind === null) { run = null; continue; }
    if (run?.kind !== kind) run = {kind, start: t};
    if (t - run.start < 3) continue;
    if (previous !== kind) {
      if (previous === 'ground' && kind === 'airborne' && takeoff === null) takeoff = run.start;
      if (previous === 'airborne' && kind === 'ground') landing = run.start;
      previous = kind;
    }
  }
  if (fixes[0]?.speed >= 8) takeoff = null;
  if (fixes.at(-1)?.speed >= 8) landing = null;
  return {takeoff, landing};
}
