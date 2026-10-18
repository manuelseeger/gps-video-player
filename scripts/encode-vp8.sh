#!/usr/bin/env bash
# Compatibility encode: VP8, limited-range BT.709, two-second keyframes.
set -euo pipefail
cd "$(dirname "$0")/.."
ffmpeg -hide_banner -loglevel error -y -i output/planfait-fpv.webm \
  -vf 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p' \
  -c:v libvpx -b:v 1800k -crf 10 -deadline good -cpu-used 4 -threads 8 \
  -g 48 -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -an output/planfait-fpv-vp8.webm
