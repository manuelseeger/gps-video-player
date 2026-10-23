function igc(steps) {
  let latitude = 0;
  return steps.map((step, second) => {
    latitude += step;
    return `B12${String(Math.floor(second / 60)).padStart(2, '0')}${String(second % 60).padStart(2, '0')}480${String(latitude).padStart(4, '0')}N01100000EA0100001000`;
  }).join('\n');
}

const ground = Array(9).fill(0), airborne = Array(12).fill(12), stopped = Array(10).fill(0);
export const landmarkTracks = {
  both: igc([...ground, ...airborne, ...stopped]),
  ground: igc(Array(12).fill(0)),
  startsAirborne: igc([...airborne, ...stopped]),
  endsAirborne: igc([...ground, ...airborne]),
};
