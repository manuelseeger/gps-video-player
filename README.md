# Planfait / Lac d’Annecy — pilot study

A silent, 90-second low-poly paragliding animation. Muted green slopes, pale limestone cliffs, turquoise water and small terracotta-roof villages form a rough comic landscape. Boots, harness edges, brake loops, risers and suspension lines establish a seated pilot view.

## Deliverables

- **Video:** [`output/planfait-fpv-vp8.webm`](output/planfait-fpv-vp8.webm)
- **Contact sheet:** [`previews/contact-sheet.jpg`](previews/contact-sheet.jpg)
- **Opening frame:** [`previews/video-00.jpg`](previews/video-00.jpg)
- **Banked lake view:** [`previews/video-56.jpg`](previews/video-56.jpg)
- **Validation:** [`output/validation.json`](output/validation.json)

The video contains 2,160 frames: **1280 × 720, 24 fps, 90.000 seconds, VP8, yuv420p, limited-range BT.709**. Size: **20,145,736 bytes (19.21 MiB)**. It has no audio stream. Frames contain no visible text, labels, titles, credits or HUD. The full scene is uncropped, with no blur masks. Source credits are stored in its WebM comment metadata and the source documents.

For app integration, copy **only `output/planfait-fpv-vp8.webm`** to the app’s video location. The rendering project is separate from the app.

## Flight alignment

`input/track.igc` is the fixed, synthetic, 91-fix flight. Its SHA-256 is:

```text
1bfb3542667c133e1e38c3ca0c7218eccb00f30ef2efac3d5b65f8840ea12549
```

`prepare-flight.mjs` reads the IGC positions and integer MSL altitudes directly. It obtains unwrapped **air-relative** headings and speeds from the copied `generateMountainFlight()` function. It verifies that this function encodes the exact input IGC bytes. It writes only `data/flight.json`, never the input track.

At each frame, position, altitude, heading and speed are interpolated between the one-second fixes. The camera uses a local geographic frame centred on **45.842° N, 6.245° E**:

```text
x = (longitude - 6.245) × 111195 × cos(45.842°)   # east, metres
z = (45.842 - latitude) × 111195                 # south, metres
y = IGC altitude                               # MSL, metres
```

Terrain and lake coordinates use this same frame. North is negative Z. There is no vertical terrain exaggeration or invented camera route.

| Time | Air-relative heading change |
| --- | --- |
| 0–20 s | Straight glide at 280° |
| 20–28 s | +45° right entry |
| 28–60 s | **+720°**, exactly **22.5°/s**, two 16-second rotations |
| 60–68 s | +40° right departure |
| 68–90 s | Straight glide at unwrapped 1085°, equivalent to 5° |

Bank is derived from `atan(speed × turnRate / gravity)`, about 20° right in the thermal. Short bank transitions do not change the heading schedule. Head motion adds small, continuous gaze, pitch and sway offsets. The camera looks about 12° below the horizon through a 61° vertical field of view.

## Geographic scene

- **Real terrain:** 20 cached AWS / Mapzen Terrarium tiles at zoom 11. Terrarium RGB values decode to MSL metres. The source pixel spacing is about 54 m at this latitude.
- **Mesh:** a 244 × 231 sampling grid, 125 m spacing near the flight and 300 m farther away. The geographic extent is about 52 × 48 km. Triangles have flat normals and plain colours. Height and slope control meadow, forest and cliff colours.
- **Real lake outline:** OpenStreetMap relation **2390533**, obtained through Nominatim with `polygon_geojson=1`. Shoreline points are simplified at approximately 45 m spacing. The characteristic two lake basins and Duingt bend use this outline. The stylized water surface is placed at 449.5–450 m MSL.
- **Local relief:** the DEM supplies the Planfait slopes, Dents de Lanfon, the Tournette area and the surrounding ridges. The two very distant blue silhouette bands are graphic scenery.
- **Villages:** simplified building clusters at geographic village centres, including Talloires, Menthon, Veyrier, Annecy, Sévrier, Saint-Jorioz, Duingt, Doussard and Bluffy. Individual building footprints and trees are illustrative.

All landscape surfaces use flat polygon colours. There are no satellite or photographic textures. This is synthetic visual material, not navigation data.

## Reproduce

Requirements: Node.js 22 or later, Python 3 with Pillow, FFmpeg with `libvpx`, and Playwright Chromium. The supplied film used Node.js 26.12.0, Playwright 1.64.1, Pillow 12.3.0 and FFmpeg 9.0.2.

```sh
npm ci
npx playwright install chromium
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt

npm run flight
npm run preview
npm run render
npm run contact
npm run validate
```

The data and Three.js modules are included. Rendering requires no network access after dependency installation. Chromium uses SwiftShader, so a GPU and desktop display are not required. The temporary asset server binds to `0.0.0.0` and closes when the render ends. Rendering has a 20-minute time limit. A full render takes about 4 minutes 30 seconds on the reference system.

The renderer captures deterministic 1280 × 720 JPEG frames at quality 95 and streams them directly to `scripts/encode-vp8.sh`. The encoder converts full-range JPEG YCbCr (BT.601 matrix) to limited-range BT.709 YCbCr once, then encodes VP8 at 1800 kbit/s with CRF 10, two-second keyframes, 4:2:0 pixels, 24 fps, no audio and exactly 2,160 frames. There is no intermediate video encode. The output file is replaced. Browser and encoder versions can change exact output bytes.

To rebuild the terrain grid and lake feature from the cached source files:

```sh
python scripts/prepare-data.py
```

Missing DEM tiles are downloaded with four concurrent requests and 40-second request limits. The raw lake response is reused when present. `data/sources.json` lists tile IDs, URLs and source credits. The copied manifest and terrain-check script in `input/` are reference inputs; they are not render entry points.

## Validation

`npm run validate` asserts the track checksum through exact generator/IGC equality, the entry/departure angles, every one-second thermal heading step, video dimensions, VP8 codec, limited range, BT.709 matrix, pixel format, frame rate, decoded frame count, exact container duration and positive thermal bank. It saves the video checksum and probe results to `output/validation.json`.

The contact-sheet captions are outside its decoded frame thumbnails; they are not part of the video. Visual review of all 12 thumbnails confirms that the sampled frames have no lettering. `previews/frame-*.jpg` are direct browser captures. `previews/video-*.jpg` and the contact sheet are decoded from the delivered WebM. `previews/camera-samples.json` records geographic camera positions, headings, bank and sampled ground height. A full `ffmpeg -v error -i output/planfait-fpv-vp8.webm -f null -` decode also passes.

## Source attribution and licences

### Terrain

**AWS / Mapzen Terrain Tiles. Produced using Copernicus data and information funded by the European Union — EU-DEM layers.** Global SRTM and GMTED2010 data courtesy of the U.S. Geological Survey.

- Tile source: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
- [AWS Terrain Tiles registry](https://registry.opendata.aws/terrain-tiles/)
- Complete provider attribution: [`data/TERRAIN-ATTRIBUTION.md`](data/TERRAIN-ATTRIBUTION.md)
- [Mapzen data sources and terms](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md)

The supplied DEM grid is a nearest-pixel sample and polygon simplification of those data. Provider terms apply to the terrain source data.

### Lake

**© OpenStreetMap contributors.** The lake boundary and the supplied lake data are available under the [Open Database Licence 1.0](https://opendatacommons.org/licenses/odbl/1-0/). See [OpenStreetMap copyright](https://www.openstreetmap.org/copyright). The raw Nominatim response and the derived GeoJSON are supplied in `data/`.

### Renderer

Three.js **0.180.0**, MIT licence; see [`vendor/THREE-LICENSE.txt`](vendor/THREE-LICENSE.txt). Rendering code uses the repository’s MIT licence in `LICENSE`. The synthetic track has no recorded pilot data or personal metadata.

Branch base: `0b20b479461bf6bf2b454e369c41881257622ad5`.
