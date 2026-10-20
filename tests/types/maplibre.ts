import type {StyleSpecification} from 'maplibre-gl';
import type {ManifestMap, MapStyle} from 'gps-video-player';

export function acceptRendererStyle(style: StyleSpecification): ManifestMap {
  const structuralStyle: MapStyle = style;
  return {style: structuralStyle};
}
