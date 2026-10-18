import {MapView} from '@deck.gl/core';

/** Match MapLibre's elevated camera target even when no DEM is configured. */
const cameras = new WeakMap();
export class FlightMapView extends MapView {
  constructor(map) { super({id:'mapbox'}); cameras.set(this, map); }
  makeViewport(props) {
    const map = cameras.get(this);
    if (!map.getTerrain()) props = {...props, viewState:{...props.viewState, position:[0, 0, map.getCenterElevation()]}};
    return super.makeViewport(props);
  }
}
