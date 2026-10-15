#!/usr/bin/env bash
# Regenerate the signed DASH test fixtures under tests/fixtures/.
#
#   1. ffmpeg renders an 8 s synthetic clip (test pattern + tone) and packages
#      it as unsigned fMP4 DASH, one directory per representation.
#   2. examples/sign_fixtures.rs signs it with c2pa-rs
#      `Builder::sign_fragmented_files` (es256 test cert from c2pa-rs).
#   3. A copy with one media segment's mdat corrupted is written to
#      tests/fixtures/tampered/ for negative tests.
#
# Requires ffmpeg. Run from anywhere: scripts/make-fixtures.sh
set -euo pipefail

cd "$(dirname "$0")/.."
FIX=tests/fixtures

rm -rf "$FIX/unsigned" "$FIX/signed" "$FIX/tampered"
# ffmpeg's dash muxer does not create per-representation directories.
mkdir -p "$FIX/unsigned/0" "$FIX/unsigned/1"

ffmpeg -hide_banner -loglevel error \
    -f lavfi -i "testsrc2=size=320x180:rate=30:duration=8" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=8" \
    -map 0:v -map 1:a \
    -c:v libx264 -profile:v main -preset veryfast -b:v 300k \
    -g 30 -keyint_min 30 -sc_threshold 0 -pix_fmt yuv420p \
    -c:a aac -b:a 64k \
    -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
    -f dash -seg_duration 1 -use_timeline 0 -use_template 1 \
    -init_seg_name '$RepresentationID$/init.mp4' \
    -media_seg_name '$RepresentationID$/seg-$Number$.m4s' \
    "$FIX/unsigned/stream.mpd"

cargo run --quiet --example sign_fixtures -- "$FIX/unsigned" "$FIX/signed"
cp "$FIX/unsigned/stream.mpd" "$FIX/signed/stream.mpd"
chmod -R a+rX "$FIX/signed"

cp -R "$FIX/signed" "$FIX/tampered"
cargo run --quiet --example sign_fixtures -- --tamper "$FIX/tampered/0/seg-3.m4s"

echo "fixtures written to $FIX/{unsigned,signed,tampered}"
