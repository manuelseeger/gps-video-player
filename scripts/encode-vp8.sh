#!/usr/bin/env bash
# Encode full-range browser JPEG frames from stdin directly to limited-range VP8.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ffmpeg -hide_banner -loglevel warning -y \
  -f image2pipe -framerate 24 -vcodec mjpeg -i pipe:0 \
  -vf 'scale=in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p' \
  -c:v libvpx -b:v 1800k -crf 10 -deadline good -cpu-used 4 -threads 8 \
  -g 48 -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -frames:v 2160 -an \
  -metadata 'title=Planfait / Lac d’Annecy — low-poly pilot study' \
  -metadata 'comment=Terrain: AWS / Mapzen. Produced using Copernicus data and information funded by the European Union - EU-DEM layers. SRTM/GMTED2010 courtesy of USGS. Lake outline: © OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright. Synthetic flight; not navigation data.' \
  output/planfait-fpv-vp8.webm
