#!/usr/bin/env sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
rm -rf "$root/hls" "$root/dash" "$root/webm"
mkdir -p "$root/hls" "$root/dash" "$root/webm"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=320x180:rate=10' -t 2 -an \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -g 10 -keyint_min 10 -sc_threshold 0 \
  -f hls -hls_time 1 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename video-init.mp4 \
  -hls_segment_filename "$root/hls/video-%02d.m4s" \
  "$root/hls/video.m3u8"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'sine=frequency=1000:sample_rate=48000' -t 2 -vn \
  -c:a aac -b:a 96k \
  -f hls -hls_time 1 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename audio-init.mp4 \
  -hls_segment_filename "$root/hls/audio-%02d.m4s" \
  "$root/hls/audio.m3u8"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=320x180:rate=10' \
  -f lavfi -i 'sine=frequency=1000:sample_rate=48000' -t 2 \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -g 10 -keyint_min 10 -sc_threshold 0 \
  -c:a aac -b:a 96k \
  -f dash -seg_duration 1 -use_template 1 -use_timeline 1 \
  -adaptation_sets 'id=0,streams=v id=1,streams=a' \
  "$root/dash/presentation.mpd"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=320x180:rate=10' \
  -f lavfi -i 'sine=frequency=1000:sample_rate=48000' -t 2 \
  -map 0:v:0 -map 1:a:0 \
  -c:v libvpx-vp9 -deadline good -cpu-used 4 -b:v 200k -g 10 \
  -c:a libopus -b:a 64k -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
  -f dash -dash_segment_type webm -seg_duration 1 \
  -use_template 1 -use_timeline 1 \
  -adaptation_sets 'id=0,streams=v id=1,streams=a' \
  "$root/webm/presentation.mpd"
