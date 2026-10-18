/** Version 1 server contract. All internal UTC values are Unix seconds. */
export function utcInstant(value, label = 'timestamp') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw new Error(`Invalid UTC ${label}`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value.replace(/(?:\.(\d{1,3}))?Z$/, (_, f) => `.${(f || '').padEnd(3, '0')}Z`)) throw new Error(`Invalid UTC ${label}`);
  return ms / 1000;
}
export function resourceUrl(value, base, {media = false} = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Resource URL must be a non-empty string');
  const url = new URL(value, base);
  if (!['https:', 'http:', ...(media ? ['blob:'] : [])].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe resource URL');
  return url.href;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
}
export function validateManifest(input, baseUrl) {
  object(input, 'manifest');
  if (input.version !== 1) throw new Error('Unsupported manifest version');
  const base = resourceUrl(baseUrl);
  object(input.track, 'track');
  const track = {...input.track};
  if ((typeof track.igc === 'string') === (typeof track.url === 'string')) throw new Error('Track requires exactly one of url or igc');
  if (track.url !== undefined) track.url = resourceUrl(track.url, base);
  track.start = utcInstant(track.startUtc, 'track.startUtc');
  if (!Array.isArray(input.clips)) throw new Error('clips must be an array');
  let end = -Infinity;
  const clips = input.clips.map((c, i) => {
    object(c, `clip ${i}`);
    const start = utcInstant(c.startUtc, `clip ${i}.startUtc`), duration = c.durationSeconds, offset = c.mediaOffsetSeconds ?? 0;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(offset) || offset < 0 || !Number.isFinite(offset + duration) || !Number.isFinite(start + duration) || start + duration <= start || start + duration > 253402300799) throw new Error(`Invalid clip ${i} duration or media offset`);
    if (start < end) throw new Error(`Clip ${i} overlaps or is out of order`);
    end = start + duration;
    return {...c, src:resourceUrl(c.url, base, {media:true}), startUtcSeconds:start, durationSeconds:duration, mediaOffsetSeconds:offset};
  });
  const metadata = input.metadata ?? {};
  object(metadata, 'metadata');
  for (const key of ['title', 'description']) if (metadata[key] !== undefined && typeof metadata[key] !== 'string') throw new Error(`Invalid metadata.${key}`);
  if (metadata.timeZone !== undefined) new Intl.DateTimeFormat('en', {timeZone:metadata.timeZone});
  const map = structuredClone(input.map ?? {});
  object(map, 'map');
  if (typeof map.style === 'string') map.style = resourceUrl(map.style, base);
  else if (map.style !== undefined) object(map.style, 'map.style');
  if (map.terrain !== undefined) {
    object(map.terrain, 'terrain');
    if (typeof map.terrain.source !== 'string' || !map.terrain.source || (map.terrain.exaggeration !== undefined && (!Number.isFinite(map.terrain.exaggeration) || map.terrain.exaggeration < 0))) throw new Error('Invalid terrain');
  }
  return {version:1, baseUrl:base, metadata:{...metadata}, track, clips, map};
}

/** Auth is restricted to one origin. Authenticated redirects fail closed. */
export function createResourceLoader({fetch: adapter = globalThis.fetch, request = {}, authOrigin} = {}) {
  const headers = new Headers(request.headers);
  const credentials = request.credentials ?? 'omit';
  if (!['omit', 'same-origin', 'include'].includes(credentials)) throw new Error('Invalid credentials mode');
  if (([...headers].length > 0 || credentials !== 'omit') && !authOrigin) throw new Error('Explicit authOrigin is required for request headers or credentials');
  const origin = authOrigin === undefined ? null : new URL(resourceUrl(authOrigin)).origin;
  return async (url, signal) => {
    url = resourceUrl(url);
    const trusted = new URL(url).origin === origin;
    const authenticated = trusted && ([...headers].length > 0 || credentials !== 'omit');
    const response = await adapter(url, {method:'GET', signal, headers:trusted ? new Headers(headers) : new Headers(), credentials:trusted ? credentials : 'omit', redirect:authenticated ? 'error' : 'follow', referrerPolicy:'no-referrer'});
    if (!response.ok) throw new Error(`Resource request failed (${response.status})`);
    return response;
  };
}

export async function resolveStyle(map, baseUrl, load, signal) {
  let style = map.style ?? {version:8, sources:{}, layers:[{id:'background', type:'background', paint:{'background-color':'#10202a'}}]};
  if (typeof style === 'string') {
    const response = await load(style, signal);
    baseUrl = response.url || style;
    style = await response.json();
  }
  style = structuredClone(style);
  if (style.version !== 8 || !style.sources || !Array.isArray(style.layers)) throw new Error('Invalid MapLibre style');
  // Resolve TileJSON ourselves so redirects and relative tile templates use its final URL.
  for (const source of Object.values(style.sources)) {
    let base = baseUrl;
    if (source.url && ['vector', 'raster', 'raster-dem'].includes(source.type)) {
      const response = await load(resourceUrl(source.url, base), signal);
      base = response.url || resourceUrl(source.url, base);
      Object.assign(source, await response.json());
      delete source.url;
    }
    if (source.tiles) source.tiles = source.tiles.map(url => templateUrl(url, base));
    if (typeof source.data === 'string') source.data = resourceUrl(source.data, base);
    if (source.url) source.url = resourceUrl(source.url, base);
    if (source.urls) source.urls = source.urls.map(url => resourceUrl(url, base, {media:true}));
  }
  if (style.glyphs) style.glyphs = templateUrl(style.glyphs, baseUrl);
  if (typeof style.sprite === 'string') style.sprite = resourceUrl(style.sprite, baseUrl);
  else if (Array.isArray(style.sprite)) style.sprite = style.sprite.map(s => ({...s, url:resourceUrl(s.url, baseUrl)}));
  if (map.terrain && !style.sources[map.terrain.source]) throw new Error('Terrain source is missing from style');
  return style;
}
function templateUrl(value, base) {
  // Protect only literal tokens. Encoded braces can be signed data, not templates.
  if (typeof value !== 'string') return resourceUrl(value, base);
  let prefix = 'gps-video-player-template-';
  while (value.includes(prefix) || String(base).includes(prefix)) prefix += '-';
  const tokens = [];
  const protectedValue = value.replace(/\{[^{}]*\}/g, token => {
    tokens.push(token);
    return `${prefix}${tokens.length - 1}-end`;
  });
  return resourceUrl(protectedValue, base).replace(new RegExp(`${prefix}(\\d+)-end`, 'g'), (_, i) => tokens[i]);
}

export async function loadManifest(input, options, signal) {
  const isUrl = typeof input === 'string' || input instanceof URL;
  const initialUrl = isUrl ? resourceUrl(String(input), options.baseUrl) : resourceUrl(options.baseUrl);
  const load = createResourceLoader(options);
  let data = input, base = initialUrl;
  if (isUrl) {
    const response = await load(initialUrl, signal);
    base = response.url || initialUrl;
    data = await response.json();
  }
  const manifest = validateManifest(data, base);
  const igc = manifest.track.igc ?? await (await load(manifest.track.url, signal)).text();
  const style = await resolveStyle(manifest.map, base, load, signal);
  return {manifest, igc, style};
}
