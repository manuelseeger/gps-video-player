import * as maplibregl from 'maplibre-gl';
import workerCode from 'virtual:map-worker';

// MapLibre 6.14's global RTL/resource dispatcher retains a worker after Map.remove().
// This adapter owns only the bundled renderer copy. Preserve its handlers so a later
// player can restart the same dispatcher without leaving idle workers on the page.
let count = 0, workerUrl, suspended = false, handlers = {};
export function acquireRenderer() {
  count++;
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([workerCode], {type:'text/javascript'}));
    maplibregl.setWorkerUrl(workerUrl);
  }
  const dispatcher = maplibregl.getGlobalDispatcher();
  if (suspended) {
    suspended = false;
    dispatcher.removed = false;
    dispatcher.actorsPromise = dispatcher.initActors(dispatcher.id);
    for (const [type, handler] of Object.entries(handlers)) dispatcher.registerMessageHandler(type, handler);
  }
}
export function releaseRenderer() {
  if (--count !== 0) return;
  const dispatcher = maplibregl.getGlobalDispatcher();
  // Initialization and worker termination are asynchronous in MapLibre.
  dispatcher.actorsPromise.then(() => {
    if (count !== 0 || suspended) return;
    handlers = {...dispatcher.actors[0]?.messageHandlers};
    dispatcher.remove(); suspended = true;
    URL.revokeObjectURL(workerUrl); workerUrl = null;
  });
}
