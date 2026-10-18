# GPS Video Player

A standalone IGC/video player for an existing web page. The player includes a synchronized 3D track, MapLibre map and terrain, deck.gl flight layers, video, telemetry, altitude profile, Map/HUD modes, draggable inset, playback speed, audio and sync controls.

## Embed

Build from this directory with Node.js 22.12 or later:

```sh
npm ci
npm run build
```

Serve `dist/player.js` from your site or CDN with a JavaScript content type. This file includes all runtime JavaScript, CSS and map worker code. No import map, separate stylesheet, worker file, fonts, or runtime package installation is needed.

```html
<div id="flight" style="height:720px"></div>
<script type="module">
  import {createPlayer} from '/assets/player.js';
  const player = createPlayer(document.getElementById('flight'), {
    manifest: 'https://data.example/flights/demo/manifest.json',
    muted: true
  });
  player.on('error', event => console.error(event.detail.message));
  await player.ready;
  player.seek(12);
  // Call player.destroy() when the owning view is removed.
</script>
```

## License and third-party notices

The project uses the [MIT License](LICENSE). Bundled third-party components retain their own licenses and notices.

The build adds full third-party license and notice texts to the banner in `dist/player.js`. Keep this banner when serving or processing the single CDN file. The build generates `dist/THIRD_PARTY_NOTICES.txt`, which is also included in the npm package. Notices cover the bundled main module and worker, plus declared runtime dependency closures of prebuilt dependencies. The build fails if a dependency has no full license text. It validates the complete banner against the package notice file and the runtime dependency graph.

The npm package export is `gps-video-player`. Its `import` export points to the same built module. `npm pack --dry-run` shows the package files. The package is not published by this repository's CI.

An empty player displays “No flight loaded”. A hidden mount keeps its inset size defaults until it has visible dimensions.

The container needs a set height of at least 480 px. A width of at least 320 px is recommended. Each player appends one host element and uses its own Shadow DOM. It does not replace the container's children, read page URL parameters, use storage, or register page keyboard listeners. Multiple instances can share a page. Call `destroy()` before you remove a mount.

## API

`createPlayer(container, options)` returns immediately.

| Member | Contract |
|---|---|
| `ready` | Promise for the initial manifest, IGC and style load and renderer creation. Resolves to the player. It does not wait for video buffering or map tiles. Rejects on load failure or cancellation. With no initial manifest, resolves to an empty player. |
| `load(manifestOrUrl, overrides?)` | Load a v1 manifest URL or an inline object. Returns a Promise for the same readiness point as `ready`. Aborts the previous load and releases its media and renderer. Each load resets rate to 1× and volume to 1, and applies the initial mute option. Pending and failed loads clear previous flight readouts and the profile. A failed load leaves an empty player. `ready` continues to refer to the initial load. |
| `play()`, `pause()` | Set playback intent. Browser autoplay rules still apply. Media errors are events. |
| `seek(seconds)` | Seek on the elapsed axis. Zero is the first clip start, or the first track fix for a track-only manifest. Values are clamped to the union of track and video extents. |
| `setRate(number)` | Set a positive playback rate and update the select. Preset rates are 0.5, 1, 2 and 4; other API rates appear as a temporary option. |
| `setNudge(seconds)` | Shift track time only. Positive values show a later track position for the same video time. Reset on load; not stored. |
| `state` | Snapshot, or `null` when empty/destroyed. Includes elapsed, origin, track UTC (Unix seconds), bounds, nudge, phase, play intent, rate, clip index, clip-local time, actual media time, sampled telemetry, mode, main view and `mapReady`. |
| `on(type, listener)` | Subscribe to a `CustomEvent`; payload is `event.detail`. Returns an unsubscribe function. |
| `off(type, listener)` | Remove a subscription. |
| `destroy()` | Idempotent. Aborts loads, stops media and animation, disconnects resize observers, removes listeners and the host, releases WebGL resources and the shared map worker pool when unused. Other control calls then fail. |

Events: `load` (`metadata`, `state`), `statechange` (playback snapshot), `mapready`, `error` (load failure), `mediaerror`, `maperror` (all errors have `message`), and `destroy`. Subscribe before awaiting `ready` to observe initial events. `statechange` runs at up to 30 Hz; use it for UI state, not persistent logging. A tile failure does not stop video.

Options:

- `manifest`: URL string, URL object, or inline v1 object. Optional.
- `baseUrl`: absolute HTTP(S) URL. Required for an inline manifest; also resolves a relative manifest URL. The player does not use the host page as an implicit base.
- `initialTime`: finite elapsed seconds, default 0. Used for each load.
- `muted`: initial mute state for each load, default `true`.
- `fetch`: optional Fetch-compatible adapter for manifest, IGC, style JSON and TileJSON requests. Must honor the supplied abort signal and security options and return a Response-compatible object. Preserve `response.url` after redirects.
- `request`: `{headers, credentials}` for these JSON/text requests. Credentials default to `omit`.
- `authOrigin`: explicit absolute HTTP(S) URL that sets the single allowed origin for `request` headers/cookies. Required when `request.headers` has any header (including non-auth headers) or `request.credentials` is not `omit`. There is no inferred auth origin. This scope stays fixed across redirects and successive manifest loads, unless explicitly overridden.
- `nonce`: optional nonce for the injected stylesheet.

`load` overrides support resource-loading options such as `baseUrl`, `fetch`, `request` and `authOrigin`. Use a new player to change UI initialization options.

Inline example:

```js
const player = createPlayer(container);
await player.load(manifestObject, {
  baseUrl: 'https://data.example/releases/42/manifest.json',
  request: {headers: {Authorization: `Bearer ${token}`}},
  authOrigin: 'https://data.example'
});
```

Headers and credentials are supplied only to that exact origin. Authenticated requests use `redirect: 'error'` to prevent redirect credential leakage. Public requests use `credentials: 'omit'` and follow redirects. Use the final authenticated URL directly if the server requires auth. A custom adapter is trusted application code; it must retain these protections.

The fetch adapter does **not** intercept browser media or MapLibre tile/glyph/sprite/image requests. Map requests omit cookies; video uses anonymous CORS (same-origin cookies can still apply). Use public or signed resource URLs for these resources. Auth headers are never copied to media or map requests. Do not place unrelated credentials in resource URLs. Serve cross-origin resources with appropriate CORS headers.

## Server manifest v1

The server owns alignment and media preparation. For optional server-side alignment, see [gps-video-sync](https://github.com/manuelseeger/gps-video-sync).

The server can expose the manifest at any path:

```json
{
  "version": 1,
  "metadata": {
    "title": "Example flight",
    "description": "Optional plain text",
    "timeZone": "UTC"
  },
  "track": {
    "url": "./track.igc",
    "startUtc": "2030-01-01T23:59:55Z"
  },
  "clips": [
    {
      "url": "./video.webm",
      "startUtc": "2030-01-01T23:59:55Z",
      "durationSeconds": 4,
      "mediaOffsetSeconds": 1
    },
    {
      "url": "./video.webm",
      "startUtc": "2030-01-02T00:00:01Z",
      "durationSeconds": 4,
      "mediaOffsetSeconds": 3
    }
  ]
}
```

Rules:

- `version` is the number `1`. Other versions fail validation.
- Timestamps are complete UTC ISO strings: `YYYY-MM-DDTHH:mm:ss[.SSS]Z`, with 1–3 optional fractional digits. Invalid dates, timezone offsets, leap seconds and ambiguous date-only strings are rejected.
- `track` contains exactly one of `url` (IGC text URL) or `igc` (inline IGC text), plus `startUtc`.
- `track.startUtc` is the UTC instant of the **first valid GPS fix**, not the recording header or midnight. It is authoritative. IGC date headers do not control alignment. Subsequent IGC time differences and midnight rollovers determine fix instants. Invalid, void, duplicate and backward fixes are skipped; a backward time jump of more than 12 hours is a midnight rollover. Logs need at least two valid fixes and must not have gaps of a full day or more without records.
- `clips` is an ordered array; it can be empty for track-only playback. Clips must not overlap. Adjacent clips and gaps are valid. Intervals include the start and exclude the end.
- Each clip has `url`, `startUtc`, and positive finite `durationSeconds`. `mediaOffsetSeconds` defaults to 0 and must be finite and non-negative. The media must cover the full trim range. A short media file emits a warning.
- At elapsed `e` within a clip: `mediaTime = e - (clipStart - origin) + mediaOffsetSeconds`. Track UTC is `origin + e + nudge`. Clip trim offsets never change the track clock.
- `metadata` is optional. `title` and `description` are plain strings. `timeZone` is an optional IANA display zone; default UTC. The readout includes the date and zone. Synchronization always uses UTC.
- URLs can be relative or absolute HTTP(S); media can also use a caller-owned Blob URL. Embedded URL usernames/passwords and unsafe schemes are rejected. The caller must revoke its own Blob URLs after use.
- Relative manifest resources resolve against the **final manifest response URL**, including public redirects. Inline objects use `baseUrl`. Relative style resources resolve against the final style URL; relative TileJSON tiles use the final TileJSON URL. Query strings are retained. Resource URLs are not tied to site-root paths or filename extensions.
- Unknown metadata and clip fields are retained. They have no player behavior.

Serve JSON as `application/json`, IGC as text, and video with its correct media type. Media servers should support HTTP byte ranges. Use a browser-supported codec/container combination, such as H.264 MP4 or VP9 WebM. Enable CORS on cross-origin manifests, logs, video and map resources. A request with Authorization can require a CORS preflight.

## Map and terrain

`map` is optional. Without it, the player uses a local dark background and draws the track without a basemap. No provider is selected by the library.

```json
{
  "map": {
    "style": {
      "version": 8,
      "sources": {
        "imagery": {
          "type": "raster",
          "tiles": ["./imagery/{z}/{x}/{y}.png"],
          "tileSize": 256,
          "attribution": "Your imagery attribution"
        },
        "dem": {
          "type": "raster-dem",
          "tiles": ["./terrain/{z}/{x}/{y}.png"],
          "tileSize": 256,
          "encoding": "terrarium"
        }
      },
      "layers": [{"id":"imagery","type":"raster","source":"imagery"}]
    },
    "terrain": {"source":"dem","exaggeration":1}
  }
}
```

Use literal braces for MapLibre template tokens such as `{z}`, `{x}`, `{y}`, `{fontstack}` and `{range}`. Percent-encoded braces stay encoded, including in signed query data.

`map.style` accepts an inline MapLibre v8 style or a style JSON URL. Raster/vector TileJSON URLs, tile templates, GeoJSON URLs, image/video sources, glyph templates and sprite URLs are resolved relative to their owning documents. Include attribution for your data. The `terrain.source` must exist in the style. Use exaggeration 1 for MSL geometry. HTTP(S) map resources and a Mercator projection are supported. Custom protocols, runtime style functions and external RTL plugins are outside this contract.

HUD hides basemap layers while retaining terrain and the synchronized track. HUD is an approximate GPS chase camera, not calibrated video AR. Flight coordinates use GPS altitude in metres MSL. The track remains visible above terrain when GPS and DEM altitudes differ. Outside the track interval, the marker and telemetry hold the nearest endpoint.

The renderer pair is MapLibre 6.14.0 and deck.gl 9.4.0. A local bridge exposes MapLibre's render transform for deck.gl; a custom MapView handles elevated camera targets without a DEM. The renderer lifecycle adapter suspends and restarts MapLibre's global resource dispatcher so the final instance releases all workers. Keep the browser smoke check when changing these dependencies.

## Controls

Click or Tab into one player to use its shortcuts. Page controls and other instances are unaffected.

- Space: play/pause. M: Map/HUD. S: swap main/inset. X: fullscreen for this player. Escape: exit its fullscreen.
- F: follow. H: heading follow. D: altitude drop line. U: mute. T/L: track start/end.
- Comma/period: nudge −/+0.1 s. Shift changes the step to 1 s. R: reset nudge.
- K: timeline focus. P: profile focus. O: opacity focus. V: volume focus. B: rate focus. I: inset handle focus.
- Profile: click/drag to seek; arrows seek 5 s; Home/End seek track endpoints.
- Inset handle: drag to move; arrows move 10 px; Shift+arrows resize. The inset corner also resizes. Geometry is constrained to the player, not the page viewport.

Shortcuts ignore text fields, native sliders/selects, links, editable content, map controls, composition and command modifiers. Space/Enter on buttons retain their native action. Only sync nudge shortcuts repeat. Focused MapLibre controls retain their native keyboard behavior.

Inside clips, media time drives playback; loading/buffering holds track time. In gaps, a monotonic clock advances the track. File switches can buffer. A 30-second media stall stops playback and emits an error; Play retries. Scrubbing commits after 150 ms or on release.

## Demo and checks

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run dev
```

`demo/` contains the demo page, its assets, and development servers. Maintenance tools are in `scripts/`. Browser checks and offline test fixtures are in `tests/`.

Vite binds to `0.0.0.0:5173`. Open `http://<server-LAN-IP>:5173/`. The default demo imports the built module; use `/?source` for source-module development. Run `npm run build` after source changes to update the default demo. `npm run demo` serves the built demo with a small Node server, also bound to all interfaces. `PORT` changes its port. These are development servers.

### Single-player mountain demo

`/` shows one large player with the map as its main view. The module selector chooses the built bundle or Vite source modules. The manifest field accepts another URL; View JSON opens the selected manifest. The Node server serves built modules only; source-module mode needs Vite.

`demo/public/demo/manifest.json` selects Esri World Imagery and AWS-hosted Mapzen Terrarium DEM tiles, with real 3D terrain at exaggeration 1. These providers are configured only in this manifest, not in the library. Public tile access, CORS and provider terms apply. Attribution is included in both map sources. Imagery credits: Esri, Vantor, Earthstar Geographics and the GIS User Community. European elevation: produced using Copernicus data and information funded by the European Union — EU-DEM layers. See [imagery terms](https://goto.arcgisonline.com/maps/World_Imagery), [AWS terrain tiles](https://registry.opendata.aws/terrain-tiles/) and [terrain source credits](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

The flight is a deterministic, synthetic 90-second paragliding excerpt above the Planfait / Lake Annecy slopes in France. Its 91 one-second fixes cover about 915 m. One 32-second thermal section from 0:28 to 1:00 contains exactly two full air-relative rotations: 0:28–0:44 and 0:44–1:00. Each takes exactly 16 seconds at a constant 22.5°/s, with no roll ramps. The thermal gains about 66 m. Fixed wind (0.8 m/s east, 0.3 m/s north) causes ground drift; ground course is not the air-relative rotation. The remaining 58 seconds contain straight glides, a +45° entry turn from 0:20 to 0:28 at 5.625°/s, and a +40° right departure turn from 1:00 to 1:08 at 5°/s, with sink and light lift. Air-relative headings are 280° on the initial glide, 325° at thermal entry, and 5° on departure: exactly 40° right of thermal entry after two full circles. Turning stays clockwise through entry, thermal and departure. Heights are about 1,878–1,948 m MSL; smoothed ground speeds are about 26–43 km/h. It is an airborne excerpt, not a takeoff/landing sequence or a navigation route. No recorded pilot data is used.

The supplied 640×360 VP9/WebM clip is a **generated test pattern, not flight-camera footage**. Labels and a time counter are burned into the video. It covers the full elapsed 0:00–1:30, with media offset zero. Both video and flight end at exactly 90 seconds. Chapter buttons seek to the initial glide, the 45-degree entry at 0:20, the thermal rotations at 0:28 and 0:44, and the 40-degree right departure at 1:00. Swap puts video or terrain in the main view. The timeline, profile, and profile Home/End controls cover the full flight.

### Test fixtures and media preparation

`tests/fixtures/regression/` contains offline test data for midnight timestamps, video trims, and playback gaps. `tests/integration.html` mounts two independent players for browser checks. The test server exposes these files only during checks.

Regenerate text fixtures with `node scripts/generate-fixture.mjs`. To regenerate the demo video, run `node scripts/generate-video.mjs` with FFmpeg installed, including its drawtext filter. Optional commands for test media:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=320x180:rate=12:duration=9' -c:v libvpx-vp9 -b:v 160k -an -y tests/fixtures/regression/demo.webm
ffmpeg -f lavfi -i 'color=c=0x800000:s=256x256' -frames:v 1 -pix_fmt rgb24 -update 1 -y tests/fixtures/regression/terrain.png
```

### Terrain verification

`node scripts/check-demo-terrain.mjs` fetches live zoom-14 Terrarium tiles and uses FFmpeg to decode ground elevation at every flight fix. It checks at least 150 m clearance. Add `--write` to refresh `tests/fixtures/ground-reference.json` after a route change. This compact real-elevation profile is tied to the IGC SHA-256 hash. Unit tests check it offline; the reference covers ground at the fixes, not navigation safety between them.

`node scripts/verify-live-demo.mjs` runs the optional public-network Chromium check, verifies successful imagery and DEM responses, measures continuous camera tracking through both rotations, and captures the demo on the initial glide and during a thermal. This check is separate from deterministic smoke. `CHROMIUM_PATH` can select the executable.

Unit tests cover synthetic flight determinism, speeds, climbs, sink, exact +45°/+40° air-relative entry/departure turns, shortest-arc heading interpolation and camera smoothing across wrap boundaries, large positive/negative headings and eight clockwise/counterclockwise rotations, and thermal turns reconstructed from displacement after wind removal (two 360° turns in 16 seconds each, 720° total with no ramps or extra thermal rotations), real-terrain clearance, demo routes, contract validation, unsafe URLs, explicit auth origin restrictions across successive loads, encoded URL data, redirect bases, full dependency notices, UTC dates/midnight, IGC parsing, timelines, trims, gaps, buffering, stale media events and shortcuts. The build check requires one output module with no runtime imports and a complete third-party notice banner. Chromium smoke starts its own Node server and tests the actual built bundle: two real maps, a separate CDN module origin, video playback/trim/gap synchronization, inline and URL manifests, redirects, terrain, keyboard isolation, nested Shadow DOM fullscreen, rate/audio resets, empty and hidden mounts, cleared pending/failed load displays, load cancellation, destroy, worker/Blob release and recreation. It also checks the single-player page with the full 90-second flight, 90-second video sync, chapter buttons and the shared end boundary, profile endpoints, responsive sizing, manifest selection and recovery. Smoke replaces the public demo's provider configuration with a local flat DEM and rejects external runtime requests. `CHROMIUM_PATH` selects a browser executable. Screenshots are saved to `/tmp/gps-video-player-player-smoke.png` and `/tmp/gps-video-player-single-player-smoke.png`.

`npm run test:browser` also runs `npm run test:camera`. This check plays elapsed 0:26–1:09 continuously at 1× in both Map and HUD modes with a local DEM. It reads actual MapLibre camera bearing from the navigation compass and checks turn direction, angular speed, course lag and accumulated rotation through the second circle. Its screenshot is `/tmp/gps-video-player-camera-tracking.png`. The camera keeps continuous headings; shared positive-modulo angle differences give the shortest turn for any number of full rotations.

## Deployment constraints

Use a modern WebGL2 browser with support for the selected media codec, Shadow DOM, ResizeObserver, fetch, ES modules and Blob workers. Fullscreen requires a user gesture and an embedding page/iframe policy that permits it. The default mute setting helps autoplay but does not override browser policy.

CSP must permit the module origin (`script-src`), Blob workers (`worker-src blob:`), inline component styles or their supplied nonce (`style-src`), inline style attributes used by map/layout controls, and your configured resource origins (`connect-src`, `img-src`, `media-src`, and fonts if used by your style). The worker contains its full code; it does not fetch a worker script from a CDN. Map libraries share a worker pool within this module; one player's removal does not terminate another player's workers.

The single module is about 3 MiB uncompressed and 0.8 MiB gzip. Each instance needs its own WebGL context. Tile availability, codec support and GPU limits remain host/browser constraints. Chromium is covered by CI; Safari and Firefox media/fullscreen behavior need deployment testing.
