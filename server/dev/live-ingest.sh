#!/bin/bash

# https://github.com/kixelated/moq-rs/blob/main/dev/pub

set -euo pipefail

# Change directory to the root of the project
cd "$(dirname "$0")/.."

# Download the Big Buck Bunny video if it doesn't exist
if [ ! -f dev/bbb.mp4 ]; then
	echo "Downloading ya boye Big Buck Bunny..."
	wget http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4 -O dev/tmp.mp4

	echo "Converting to a (properly) fragmented MP4..."
	ffmpeg -i dev/tmp.mp4 \
		-c copy \
		-f mp4 -movflags cmaf+separate_moof+delay_moov+skip_trailer+frag_every_frame \
		dev/bbb.mp4

	rm dev/tmp.mp4
fi

# Default to a source video
INPUT="${INPUT:-dev/bbb.mp4}"

# Run ffmpeg and pipe the output to moq-pub
ffmpeg -hide_banner \
    -v quiet \
	-stream_loop -1 \
	-re \
	-i "$INPUT" \
	-an \
	-c:v libx264 -b:v 600k -bufsize 200K -s 1280x720 \
	-g:v 15 -keyint_min:v 15 -sc_threshold:v 0 -bf 3 \
	-f mp4 -movflags cmaf+separate_moof+delay_moov+skip_trailer+frag_every_frame \
	-