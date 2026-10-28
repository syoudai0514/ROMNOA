# Native media fixtures

These small files were created for ROMNOA tests; they contain no third-party article images or video.

- `playback.mp4`: FFmpeg `testsrc2`, 96×96, 12 fps, 2 seconds, H.264 baseline/yuv420p, no audio, faststart.
- `animation.gif`: Pillow-generated 48×48 solid backgrounds and a white rectangle, three 150 ms frames, infinite loop.

The browser tests verify real decoding/time progression and visible GIF frame changes. HTTP video fixtures implement byte-range responses where looping/seek requires them.
