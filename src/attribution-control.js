import * as maplibregl from 'maplibre-gl';

export function parseInitialAttribution(value = 'collapsed') {
  if (value !== 'collapsed' && value !== 'expanded') throw new TypeError("initialAttribution must be 'collapsed' or 'expanded'");
  return value;
}

export class PlayerAttributionControl extends maplibregl.AttributionControl {
  #activation;

  constructor(initial) {
    super({compact: true});
    this.#activation = {kind: 'pending', initial};
  }

  _updateCompact = () => {
    if (this.#activation.kind !== 'pending') return;
    const list = this._container.classList;
    if (list.contains('maplibregl-compact') || list.contains('maplibregl-attrib-empty')) return;
    list.add('maplibregl-compact');
    if (this.#activation.initial === 'expanded') {
      list.add('maplibregl-compact-show');
      this._container.setAttribute('open', '');
    } else {
      list.remove('maplibregl-compact-show');
      this._container.removeAttribute('open');
    }
    this.#activation = {kind: 'active'};
  };

  _updateCompactMinimize = () => {
    if (!this._container.classList.contains('maplibregl-compact')) return;
    this._container.classList.remove('maplibregl-compact-show');
    this._container.removeAttribute('open');
  };
}
