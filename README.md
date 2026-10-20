# GPS Video Player

Embed synchronized video and an IGC flight track in a web page. The player has a 3D track, MapLibre map and terrain, deck.gl flight layers, telemetry and an altitude profile. It supports Map and HUD modes, a draggable inset, and controls for playback speed, audio and synchronization.

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

The npm package export is `gps-video-player`. Its `import` export points to the same built module. Run `npm pack --dry-run` to list the package files.

An empty player displays "No flight loaded". A hidden mount keeps the default inset size until the mount becomes visible.

Set the container height to at least 480 px. A width of at least 320 px is recommended. Each player appends one host element and uses its own Shadow DOM. It leaves the container's existing children intact. It does not read page URL parameters, use storage, or register page keyboard listeners. Multiple instances can share a page. Call `destroy()` before you remove a mount.

## TypeScript

The npm package includes declarations. Import types with `import type {Manifest, Player, PlayerOptions} from 'gps-video-player'`. Renderer packages are not required for type checking. `createPlayer` is the only runtime export.

`PlaybackState` describes `statechange` and `load` event snapshots. `PlayerState` adds telemetry, view mode and map readiness for `player.state`. The player state, telemetry sample, clip index, clip URL and media times can be `null`. A `maperror` message can be `undefined`. Manifest timestamps and numeric ranges are validated at runtime.

Run `npm run test:types` to build, pack and install the package in a temporary consumer, then check NodeNext, Bundler and legacy Node resolution.

## Controls

Click or Tab into one player to use its shortcuts. Page controls and other instances are unaffected.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play or pause |
| M | Switch Map/HUD mode |
| S | Swap main and inset views in Map mode |
| X | Toggle fullscreen for this player |
| Escape | Exit fullscreen for this player |
| F | Toggle position following |
| H | Toggle heading following |
| D | Toggle the altitude drop line, which is off by default |
| U | Toggle mute |
| T | Seek to track start |
| L | Seek to track end |
| , / . | Decrease/increase sync offset by 0.1 s |
| Shift+, / Shift+. | Decrease/increase sync offset by 1 s |
| R | Reset sync offset |
| K | Focus the timeline slider |
| P | Focus the altitude profile |
| O | Focus the opacity slider |
| V | Focus the volume slider |
| B | Focus the playback speed selector |
| I | Focus the inset handle |

When the altitude profile has focus:

| Key | Action |
| --- | --- |
| Left / Right | Seek backward/forward 5 s |
| Home / End | Seek to track start/end |

When the inset handle has focus in Map mode:

| Key | Action |
| --- | --- |
| Arrow keys | Move the inset 10 px |
| Shift+arrow keys | Resize the inset by 10 px |

Tab and Shift+Tab move focus between controls. Focused sliders and selectors use their native keyboard controls. Space or Enter activates a focused button.

Click or drag the altitude profile to seek. Drag the inset handle to move the inset, or drag its corner to resize it. Inset geometry is constrained to the player.

Player shortcuts do not handle input in text fields, native sliders and selectors, links, editable content or map controls. They also ignore input during composition or with command modifiers. Space and Enter keep their native button actions. Only sync nudge shortcuts repeat. Focused MapLibre controls keep their native keyboard behavior.

During clips, media time drives playback. Track time pauses while media loads or buffers. In gaps, a monotonic clock advances the track. Switching files can cause buffering. A 30-second media stall stops playback and emits an error. Press Play to retry. Scrubbing commits after 150 ms or on release.

## API

`createPlayer(container, options)` returns immediately.

| Member | Contract |
|---|---|
| `ready` | Promise for the initial manifest, IGC and style load and renderer creation. Resolves to the player. It does not wait for video buffering or map tiles. Rejects on load failure or cancellation. With no initial manifest, resolves to an empty player. |
| `load(manifestOrUrl, overrides?)` | Load a v1 manifest URL or an inline object. Returns a Promise for the same readiness point as `ready`. Aborts the previous load and releases its media and renderer. Each load resets rate to 1× and volume to 1, and applies the initial mute option. Pending and failed loads clear previous flight readouts and the profile. A failed load leaves an empty player. `ready` continues to refer to the initial load. |
| `play()`, `pause()` | Set playback intent. Browser autoplay rules still apply. Media errors are events. |
| `seek(seconds)` | Seek on the elapsed axis. Zero is the first clip start, or the first track fix for a track-only manifest. Values are clamped to the union of track and video extents. |
| `setRate(number)` | Set the playback rate from 0.0625 to 16 and update the select. Other values are ignored. Preset rates are 0.5, 1, 2 and 4; other API rates appear as a temporary option. |
| `setNudge(seconds)` | Shift track time only. Positive values show a later track position for the same video time. Reset on load; not stored. |
| `state` | Snapshot, or `null` when empty/destroyed. Includes elapsed, origin, track UTC (Unix seconds), bounds, nudge, phase, play intent, rate, clip index, clip-local time, actual media time, sampled telemetry, mode, main view and `mapReady`. |
| `on(type, listener)` | Subscribe to a `CustomEvent`; payload is `event.detail`. Returns an unsubscribe function. |
| `off(type, listener)` | Remove a subscription. |
| `destroy()` | Idempotent. Aborts loads, stops media and animation, disconnects resize observers, removes listeners and the host, releases WebGL resources and the shared map worker pool when unused. Other control calls then fail. |

The player emits these events:

- `load` includes `metadata` and `state`.
- `statechange` includes a playback snapshot. It runs at up to 30 Hz. Use it for UI state, not persistent logging.
- `mapready` reports map readiness.
- `error` reports a load failure.
- `mediaerror` and `maperror` report media and map errors. A tile failure does not stop video.
- `destroy` reports player destruction.

All error events include `message`. Subscribe before awaiting `ready` to receive initial events.

Options:

- `manifest`: URL string, URL object, or inline v1 object. Optional.
- `baseUrl`: absolute HTTP(S) URL. Required for an inline manifest; also resolves a relative manifest URL. The player does not use the host page as an implicit base.
- `initialTime`: finite elapsed seconds, default 0. Used for each load.
- `muted`: initial mute state for each load, default `true`.
- `fetch`: optional Fetch-compatible adapter for manifest, IGC, style JSON and TileJSON requests. Must honor the supplied abort signal and security options and return a Response-compatible object. Preserve `response.url` after redirects.
- `request`: `{headers, credentials}` for these JSON/text requests. Credentials default to `omit`.
- `authOrigin`: explicit absolute HTTP(S) URL that sets the single allowed origin for `request` headers and cookies. Required when `request.headers` has any header, even a non-auth header, or `request.credentials` is not `omit`. The player does not infer this origin. It stays fixed across redirects and successive manifest loads unless you override it.
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

The player sends headers and credentials only to that exact origin. Authenticated requests use `redirect: 'error'` to prevent credential leaks through redirects. Public requests use `credentials: 'omit'` and follow redirects. Use the final authenticated URL directly if the server requires auth. A custom adapter is trusted application code and must keep these protections.

The fetch adapter does not intercept browser media requests or MapLibre requests for tiles, glyphs, sprites and images. Map requests omit cookies. Video uses anonymous CORS, which can still send same-origin cookies. Use public or signed URLs for these resources. The player never copies auth headers to media or map requests. Do not place unrelated credentials in resource URLs. Serve cross-origin resources with appropriate CORS headers.

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
- Timestamps are complete UTC ISO strings: `YYYY-MM-DDTHH:mm:ss[.SSS]Z`, with 1 to 3 optional fractional digits. The player rejects invalid dates, timezone offsets, leap seconds and ambiguous date-only strings.
- `track` contains `startUtc` and exactly one of `url` or `igc`. Use `url` for an IGC text URL or `igc` for inline IGC text.
- `track.startUtc` sets the UTC instant of the first valid GPS fix. Do not use the recording header time or midnight. IGC date headers do not control alignment. Subsequent IGC time differences and midnight rollovers determine fix instants. The player skips invalid, void, duplicate and backward fixes. It treats a backward time jump of more than 12 hours as a midnight rollover. Logs need at least two valid fixes and must not have gaps of a full day or more without records.
- `clips` is an ordered array; it can be empty for track-only playback. Clips must not overlap. Adjacent clips and gaps are valid. Intervals include the start and exclude the end.
- Each clip has `url`, `startUtc`, and positive finite `durationSeconds`. `mediaOffsetSeconds` defaults to 0 and must be finite and non-negative. The media must cover the full trim range. A short media file emits a warning.
- At elapsed `e` within a clip: `mediaTime = e - (clipStart - origin) + mediaOffsetSeconds`. Track UTC is `origin + e + nudge`. Clip trim offsets never change the track clock.
- `metadata` is optional. `title` and `description` are plain strings. `timeZone` is an optional IANA display zone; default UTC. The readout includes the date and zone. Synchronization always uses UTC.
- URLs can be relative or absolute HTTP(S); media can also use a caller-owned Blob URL. Embedded URL usernames/passwords and unsafe schemes are rejected. The caller must revoke its own Blob URLs after use.
- Relative manifest resources resolve against the final manifest response URL, including public redirects. Inline objects use `baseUrl`. Relative style resources resolve against the final style URL. Relative TileJSON tiles use the final TileJSON URL. The player keeps query strings. Resource URLs do not require site-root paths or specific filename extensions.
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

`map.style` accepts an inline MapLibre v8 style or a style JSON URL. The player resolves raster and vector TileJSON URLs, tile templates, GeoJSON URLs, image and video sources, glyph templates and sprite URLs relative to their owning documents.

Include attribution for your data. The `terrain.source` must exist in the style. Use exaggeration 1 for MSL geometry. The player supports HTTP(S) map resources and a Mercator projection. It does not support custom protocols, runtime style functions or external RTL plugins.

HUD hides basemap layers while retaining terrain and the synchronized track. HUD is an approximate GPS chase camera, not calibrated video AR. Flight coordinates use GPS altitude in metres MSL. The track remains visible above terrain when GPS and DEM altitudes differ. Outside the track interval, the marker and telemetry hold the nearest endpoint.

The player uses MapLibre 6.14.0 and deck.gl 9.4.0. A local bridge exposes MapLibre's render transform for deck.gl. A custom MapView handles elevated camera targets without a DEM. The renderer lifecycle adapter suspends and restarts MapLibre's global resource dispatcher to release all workers when the last instance is destroyed. Keep the browser smoke check when changing these dependencies.

## License and third-party notices

The project uses the [MIT License](LICENSE). Bundled third-party components retain their own licenses and notices.

The build adds full third-party license and notice texts to the banner in `dist/player.js`. Keep this banner when serving or processing the single CDN file. The build generates `dist/THIRD_PARTY_NOTICES.txt`, which is also included in the npm package. Notices cover the bundled main module and worker, plus declared runtime dependency closures of prebuilt dependencies. The build fails if a dependency has no full license text. It validates the complete banner against the package notice file and the runtime dependency graph.
