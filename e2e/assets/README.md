# Generated dubbing media

These fixtures contain synthetic media only, without downloaded video, subtitles or voices.

- `dubbing.webm`: existing 20-second VP8/Opus test fixture.
- `dubbing-long.webm`: three-hour, 160 × 90 solid-color VP8 video without audio, with one
  frame per second and a keyframe every ten seconds. It exercises native duration and distant
  seeking with a small file.
  It is used with generated WAV speech and original test subtitles.

Generate the long fixture using FFmpeg:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi \
  -i 'color=c=0x263449:s=160x90:r=1:d=10800' \
  -an -c:v libvpx -g 10 -deadline realtime -b:v 12k e2e/assets/dubbing-long.webm
```

Seeking across this fixture is an accelerated timeline check. It does not constitute a
three-hour continuous playback or subjective listening acceptance.
