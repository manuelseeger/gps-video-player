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

`PlaybackState` describes `statechange` and `load` event snapshots. `PlayerState` adds telemetry, view mode and map readiness for `player.state`. The player state, telemetry sample, clip index, quality state and media times can be `null`. Playback snapshots do not contain media URLs. A `maperror` message can be `undefined`. Manifest timestamps and numeric ranges are validated at runtime.

Run `npm run test:types` to build, pack and install the package in a temporary consumer, then check NodeNext, Bundler and legacy Node resolution.

## Controls

Click or Tab into one player to use its shortcuts. Page controls and other instances are unaffected.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play or pause |
| M | Switch Map/HUD mode |
| S | Swap main and inset views in Map mode |
| F | Toggle fullscreen for this player |
| Escape | Exit fullscreen for this player |
| C | Toggle position following |
| H | Toggle heading following |
| D | Toggle the altitude drop line, which is off by default |
| U | Toggle mute |
| T | Seek to track start |
| L | Seek to track end |
| A | Show or hide advanced sync controls (off by default) |
| , / . | Decrease/increase sync offset by 0.1 s. Advanced mode only |
| Shift+, / Shift+. | Decrease/increase sync offset by 1 s. Advanced mode only |
| R | Reset sync offset. Advanced mode only |
| K | Focus the timeline slider |
| P | Focus the altitude profile |
| O | Focus the opacity slider |
| V | Focus the volume slider |
| B | Focus the playback speed selector |
| Q | Focus the quality selector when available |
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

During clips, media time drives playback. Track time pauses while media loads or buffers. In gaps, a monotonic clock advances the track. Switching files can cause buffering. A 30-second buffering stall stops playback and emits an error. Source resolution and source readiness have separate timers, including while paused. Press Play to retry. Scrubbing commits after 150 ms or on release.

## API

`createPlayer(container, options)` returns immediately.

| Member | Contract |
|---|---|
| `ready` | Promise for the initial manifest, IGC and style load and renderer creation. Resolves to the player. It does not wait for video buffering or map tiles. Rejects on load failure or cancellation. With no initial manifest, resolves to an empty player. |
| `load(manifestOrUrl, overrides?)` | Load a v1 or v2 manifest URL or an inline object. Returns a Promise for the same readiness point as `ready`. Aborts the previous load and releases its media and renderer. Each load resets rate to 1× and volume to 1, and applies the initial mute option. Pending and failed loads clear previous flight readouts and the profile. A failed load leaves an empty player. `ready` continues to refer to the initial load. |
| `play()`, `pause()` | Set playback intent. Browser autoplay rules still apply. Media errors are events. |
| `seek(seconds)` | Seek on the elapsed axis. Zero is the first clip start, or the first track fix for a track-only manifest. Values are clamped to the union of track and video extents. |
| `landmark('takeoff' \| 'landing')` | Return a `LandmarkTarget` without a seek. |
| `seekLandmark('takeoff' \| 'landing')` | Return a `LandmarkSeek`. Seek only when the event is available. |
| `setRate(number)` | Set the playback rate from 0.0625 to 16 and update the select. Other values are ignored. Preset rates are 0.5, 1, 2 and 4; other API rates appear as a temporary option. |
| `setAdvancedSync(on)` | Show or hide the sync minus, plus and Reset buttons. Hidden by default; the **Sync** button and the A key toggle it. While hidden, the buttons are disabled and `,`, `.` and R do nothing. A nonzero offset stays visible as a read-only value; at zero the sync row is removed and its space is reclaimed. Closing keeps the current nudge. Initial value: `advancedSync` option. State: `state.advancedSync`. |
| `setNudge(seconds)` | Shift track time only. Positive values show a later track position for the same video time. Works with advanced mode open or closed. Reset on load; not stored. |
| `selectQuality(id)` | Select an advertised quality. Returns a terminal acknowledgement. Both the native Quality control and app code use this operation. |
| `updateQualities(loadId, catalogue)` | Replace the catalogue for the current load with a strictly greater revision. Rejects stale load identities, stale revisions and invalid catalogues without changing playback. |
| `state` | Snapshot, or `null` when empty/destroyed. Includes elapsed, origin, track UTC (Unix seconds), bounds, nudge, phase, play intent, rate, clip index, clip-local time, actual media time, sampled telemetry, mode, main view and `mapReady`. |
| `on(type, listener)` | Subscribe to a `CustomEvent`; payload is `event.detail`. Returns an unsubscribe function. |
| `off(type, listener)` | Remove a subscription. |
| `destroy()` | Idempotent. Aborts loads, stops media and animation, disconnects resize observers, removes listeners and the host, releases WebGL resources and the shared map worker pool when unused. Other playback control calls then fail. Quality selection returns `rejected` with `no-flight`. |

### Flight landmarks

The pure track detector uses each fix time and the speed that `parseIGC` stores in metres per second. Ground samples have speed below 4 m/s. Airborne samples have speed at or above 8 m/s. A segment must cover at least 3 seconds. Samples between 4 and 8 m/s do not extend either segment and interrupt an unconfirmed run.

Takeoff requires a ground segment followed by an airborne segment. Its time is the first sample of that airborne segment. Landing requires an airborne segment followed by a ground segment. Its time is the first sample of that ground segment. The detector selects the first takeoff and the last landing. A track that starts airborne has no takeoff target. A track that ends airborne has no landing target. Track endpoints are not substitutes for events.

The IGC specification has no takeoff or landing event code. Appendix A7 defines `STA` for task start and `FIN` for task finish. C-record declared takeoff and landing positions do not give event times. The detector does not read those records.

`landmark()` returns `{status: 'available', landmark, elapsed}`, `{status: 'unavailable', landmark}`, or `{status: 'no-flight'}`. `seekLandmark()` returns `applied` instead of `available` after it calls `seek(elapsed)`. Both methods use `timeline.elapsedAtUtc(eventUtc, currentNudge)`. The returned elapsed value is the landmark value before seek clamping. An unavailable event or an empty player does not change playback. Both methods throw after destruction.

The **Takeoff** and **Landing** buttons seek to track start and track end. The T and L shortcuts use these same endpoints, not detected events. Profile Home and End also use track endpoints.

The player emits these events:

- `load` includes `metadata` and `state`.
- `statechange` includes a playback snapshot. It runs at up to 30 Hz. Use it for UI state, not persistent logging.
- `mapready` reports map readiness.
- `error` reports a load failure.
- `mediaerror` and `maperror` report media and map errors. A tile failure does not stop video. Media error details include load, revision, transition, request and clip identities when applicable.
- `qualitycatalogue` includes the load identity and quality snapshot.
- `qualitychange` includes load, revision, transition, request and clip identities, requested, active and pending IDs, a reason, and the matching quality snapshot. Status is `pending`, `candidate`, or a terminal selection status. Candidate failures remain visible even if a later fallback works. Source-resolution failures use these quality events, not `mediaerror`.
- `destroy` reports player destruction.

All error events include `message`. Subscribe before awaiting `ready` to receive initial events.

Options:

- `manifest`: URL string, URL object, or inline v1 or v2 object. Optional.
- `baseUrl`: absolute HTTP(S) URL. Required for an inline manifest; also resolves a relative manifest URL. The player does not use the host page as an implicit base.
- `initialTime`: finite elapsed seconds, default 0. Used for each load.
- `muted`: initial mute state for each load, default `true`.
- `advancedSync`: show the sync adjustment buttons initially, default `false`.
- `initialAttribution`: `'collapsed'` or `'expanded'`, default `'collapsed'`. The start state of the map attribution for each load. The info button opens the attribution. Dragging the map closes it. Any other value throws a `TypeError`.
- `fetch`: optional Fetch-compatible adapter for manifest, IGC, style JSON and TileJSON requests. Must honor the supplied abort signal and security options and return a Response-compatible object. Preserve `response.url` after redirects.
- `request`: `{headers, credentials}` for these JSON/text requests. Credentials default to `omit`.
- `authOrigin`: explicit absolute HTTP(S) URL that sets the single allowed origin for `request` headers and cookies. Required when `request.headers` has any header, even a non-auth header, or `request.credentials` is not `omit`. The player does not infer this origin. It stays fixed across redirects and successive manifest loads unless you override it.
- `nonce`: optional nonce for the injected stylesheet.
- `qualities`, `resolveSource`: catalogue and resolver for the initial load. Later loads receive these through their own overrides.
- `sourceTimeouts`: optional positive `resolveMs` and `readyMs` values, each at most 60000 ms. Defaults are 15000 ms for resolution and 20000 ms for preparation and play acknowledgement per candidate.
- `deliveries`: app delivery adapters. Only progressive video delivery ships with the player.

`load` overrides support resource-loading options such as `baseUrl`, `fetch`, `request` and `authOrigin`, plus a per-load `qualities` catalogue and `resolveSource` callback. Use a new player to change UI initialization options.

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

- `version` is the number `1` for this schema. The quality schema uses version `2`.
- Timestamps are complete UTC ISO strings: `YYYY-MM-DDTHH:mm:ss[.SSS]Z`, with 1 to 3 optional fractional digits. The player rejects invalid dates, timezone offsets, leap seconds and ambiguous date-only strings.
- `track` contains `startUtc` and exactly one of `url` or `igc`. Use `url` for an IGC text URL or `igc` for inline IGC text.
- `track.startUtc` sets the UTC instant of the first valid GPS fix. Do not use the recording header time or midnight. IGC date headers do not control alignment. Subsequent IGC time differences and midnight rollovers determine fix instants. The player skips invalid, void, duplicate and backward fixes. It treats a backward time jump of more than 12 hours as a midnight rollover. Logs need at least two valid fixes and must not have gaps of a full day or more without records.
- `clips` is an ordered array; it can be empty for track-only playback. Clips must not overlap. Adjacent clips and gaps are valid. Intervals include the start and exclude the end.
- Each clip has `url`, `startUtc`, and positive finite `durationSeconds`. `mediaOffsetSeconds` defaults to 0 and must be finite and non-negative. The media must cover the full trim range. A short media file fails with `mapping-failed`.
- At elapsed `e` within a clip: `mediaTime = e - (clipStart - origin) + mediaOffsetSeconds`. Track UTC is `origin + e + nudge`. Clip trim offsets never change the track clock.
- `metadata` is optional. `title` and `description` are plain strings. `timeZone` is an optional IANA display zone; default UTC. The readout includes the date and zone. Synchronization always uses UTC.
- URLs can be relative or absolute HTTP(S); media can also use a caller-owned Blob URL. Embedded URL usernames/passwords and unsafe schemes are rejected. A Blob clip requires an app-owned `release()` callback. The player calls it once per use after unloading that source. Static Blob resources must remain reacquirable while advertised.
- Relative manifest resources resolve against the final manifest response URL, including public redirects. Inline objects use `baseUrl`. Relative style resources resolve against the final style URL. Relative TileJSON tiles use the final TileJSON URL. The player keeps query strings. Resource URLs do not require site-root paths or specific filename extensions.
- Unknown metadata and clip fields are retained. They have no player behavior.

Serve JSON as `application/json`, IGC as text, and video with its correct media type. Media servers should support HTTP byte ranges. Use a browser-supported codec/container combination, such as H.264 MP4 or VP9 WebM. Enable CORS on cross-origin manifests, logs, video and map resources. A request with Authorization can require a CORS preflight.

## Video quality contract

Quality, mute, volume and fullscreen controls sit inside the player window at the bottom right. They stay there in both main views, HUD and fullscreen. The lower panel contains telemetry, the altitude profile and timing controls.

A quality ID identifies an app-defined choice, not a URL or a resolution. The app supplies labels, order, default, fallback policy and resources. The player does not discover files, rank resolutions or rewrite extensions.

### Static manifest v2

Version 2 keeps the same track, metadata, map and logical clip intervals as v1. Each clip replaces `url` and `mediaOffsetSeconds` with a `sources` table. Entries are source descriptors without the `quality` field. Their table key supplies that identity.

```json
{
  "version": 2,
  "track": {"url": "./track.igc", "startUtc": "2030-01-01T10:00:00Z"},
  "qualities": {
    "options": [{"id": "economy", "label": "Data saver"}, {"id": "detail", "label": "Fine view"}],
    "default": "economy",
    "fallback": ["economy", "detail"]
  },
  "clips": [{
    "startUtc": "2030-01-01T10:00:00Z",
    "durationSeconds": 10,
    "sources": {
      "economy": {"url": "./opaque.webm", "type": "video/webm", "mediaStartSeconds": 2},
      "detail": {"url": "https://media.example/another?sig=example", "type": "video/mp4", "mediaStartSeconds": 7}
    }
  }]
}
```

`revision` defaults to 1 in a static manifest. Option IDs are unique non-empty strings. Labels are plain text. Optional `width`, `height`, `bitrateKbps` and `codecs` are descriptive hints. `default` and every `fallback` entry refer to declared IDs. Fallback order is explicit and contains no duplicates. An unsupported default stays requested. Only declared fallback candidates can replace it.

Static availability derives from the source table. A missing entry is unavailable for that clip. Relative resources use the final manifest URL or the explicit inline `baseUrl`. Signed query bytes remain intact. Version 1 fixed sources use this same acquisition contract as the hidden `original` choice.

### Per-load resolution

A resolver overrides static source entries. The catalogue can come from the manifest or `load` overrides. A supplied catalogue has an integer `revision` and optional `availability` rows indexed by clip. Entries are `available`, `unavailable` or `unknown`. Missing dynamic availability is unknown. A known unavailable choice remains selectable as a preference for later clips.

```js
await player.load(manifest, {
	baseUrl: 'https://data.example/manifest.json',
	qualities: {
		revision: 1,
		options: [{id: 'economy', label: 'Data saver'}, {id: 'detail', label: 'Fine view'}],
		default: 'economy',
		fallback: ['economy']
	},
	async resolveSource(request) {
		const response = await appMediaApi(request.clip.index, request.quality, request.signal);
		if (!response.available) return {status: 'unavailable'};
		return {status: 'source', source: {
			quality: request.quality,
			url: response.absoluteUrl,
			type: response.mediaType,
			mediaStartSeconds: response.startSeconds
		}};
	}
});
const result = await player.selectQuality('detail');
```

`SourceRequest` contains `load`, `revision`, `transition`, `request`, `clip`, `quality`, `localTime` and `signal`. The clip record has its load-local `index`, `startUtc` and `durationSeconds`. A seek cancels the accepted pending selection. A same-clip seek reuses healthy media when it matches the requested preference. A new clip, a different preference or failed reuse requires fresh resolution at the latest clip-local time. Pause changes intent without cancelling relevant resolution. New loads and destroy cancel outstanding requests.

The resolver returns `source`, `unavailable`, `unsupported`, or `failed`. A failed result includes a safe plain-text `message` and `retryable` boolean. Thrown exception text is private. Messages with URLs, authorization terms or control characters become generic player messages.

A descriptor has the exact requested `quality`, an absolute HTTP(S) or Blob `url`, optional `type`, optional `delivery`, and non-negative `mediaStartSeconds`, default 0. It must represent the same complete logical clip. Media time equals clip-local time plus this source offset. It must decode video, cover the full interval and reach the target before the player reports applied. A finite media duration shorter than the complete interval fails with `mapping-failed`, even if the current target fits. Audio-only readiness is a media failure.

An optional `release()` callback transfers one use to the player. The player unloads media before it calls this callback once. A release method receives its original descriptor as `this`, including static manifest entries. This includes replacement, cancellation, late completion, failure, load and destroy. A Blob descriptor requires the callback. The player never revokes an app URL itself. The owner manages shared retain counts when two players use one resource. Release callbacks can return a Promise. Their failures do not block playback or destruction. A static entry must remain reacquirable while advertised. Use the resolver for expiring or one-use resources.

The resolver owns its API requests and authorization. It must supply resources compatible with browser media transport and CORS. The player's JSON fetch adapter does not intercept media or copy authorization headers to another origin.

### State, recovery and acknowledgements

`state.quality` is null for track-only playback. Otherwise it exposes the revision, supported options in app order, requested preference, active quality, pending target, Auto rendition status and last terminal outcome. Availability is null in gaps. An Auto rendition is a plain-text label or `unknown`. Source URLs never appear in playback state, quality events or acknowledgements.

A selection returns one of these results:

- `applied` means usable at the intended position. `outcome` is `applied` or `fallback`. The result includes requested and active IDs, a reason and actual `playing` status.
- `deferred` records a gap preference without a source request.
- `failed` includes a safe message, reason, retryable flag and the restored active ID, if any.
- `cancelled` includes the supersession, removal, load or destroy reason.
- `rejected` means no operation started. Unknown or unsupported IDs and an absent flight do not change playback.

Duplicate pending selections share the same terminal result. Selecting a healthy active choice is a no-op, including after autoplay rejection. Selecting a fallback preference again or pressing Retry quality resolves a fresh resource. For a fallback or failed attempt, Retry quality is available when the requested choice is supported and not marked unavailable for the current clip. A single fixed source keeps the quality row hidden, including on error. Play remains its retry action. Each new load uses its own declared default and catalogue. Players do not share preferences or use browser storage.

A catalogue revision does not interrupt healthy mid-clip playback solely because a rendition becomes available. The next clip, seek or explicit Retry applies the retained preference. A revision cancels an old-revision pending selection with `superseded`, or `removed` if its preference disappears. Any continuing attempt has the new revision and a separate outcome. A still-supported active source remains available for rollback.

A transition freezes the flight clock and preserves rate, audio, sync nudge, view and fullscreen. A failed requested switch restores the previous usable source before trying fallback candidates. A successful restoration reports `failed` with that active ID. Play resumes the restored source without retrying the failed preference. Ordinary resume retains the fallback reason. A same-clip seek keeps the old source for restoration if fresh resolution fails. Each declared candidate has at most one acquisition per attempt. A removed active quality remains owned until a replacement commits or playback stops, but cannot be the final restored result. Exhaustion stops at the same position with active null. Play or another selection retries without reloading the flight.

Readiness and play acknowledgement share the candidate timer. Paused and hidden-page waits use scheduled timers rather than animation frames. Finite candidates bound an attempt. A browser process suspension can delay JavaScript. On resumption, expired readiness cannot commit. Autoplay rejection can commit a usable paused frame with `playing: false`, reason `autoplay-blocked` and an instruction to press Play.

### Delivery adapters

Progressive delivery accepts browser-supported video. An empty `canPlayType` result rejects a declared type. `maybe` and `probably` still require decoded video readiness. Arbitrary HLS, DASH and DRM formats need an app adapter. No adaptive engine ships with this package.

An option can declare `mode: 'auto'` and `delivery: {kind, type?}`. Auto requires an adapter with `adaptive: true`. A fixed option for a custom delivery requires `pinned: true`. Unsupported choices are not advertised. Auto alone is status, not a multiple-choice selector.

A `DeliveryAdapter` supplies `kind`, `adaptive`, `pinned`, `supports(type)` and async `attach(media, source, signal)`. The source has its resource URL, optional type and a rendition token or null for Auto. The returned attachment supplies `rendition()` and `detach()`. A fixed source descriptor declares `delivery.rendition`. Its attachment must return the exact token as `confirmedRendition` before readiness can commit. `rendition()` returns a plain-text label or null for unknown. The adapter must stop work on abort and detach its media resources. Late attachments also receive detach.

### Quality verification

`npm run test:quality` runs the built player in Chromium with generated VP8, H.264, HEVC and audio-only fixtures. It requires `ffmpeg` with libvpx, libx264 and libx265. The script uses temporary resources and offline map styles. It checks all nine quality scenarios, native keyboard input, narrow layout, fullscreen, independent players, cancellation, release and real transport failures. The HEVC expectation follows an independent decode probe in the running browser. Audio-only media must fail on every browser. Its provider fixture checks the adapter protocol with decoded media, not an adaptive engine.

`npm run test:controls` checks the built player's window controls in both main views, HUD, fullscreen and a 320px-wide mount. It checks audio, quality retry and control positions, and saves synthetic-data screenshots to a temporary directory.

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
