# Featherplay

Offloads video decoding to a beefier machine on your LAN. That machine
pulls the video with `yt-dlp` (1000+ sites supported — YouTube, Vimeo,
Twitch VODs, Dailymotion, etc.), re-encodes it live to H.264 with `ffmpeg`
(NVENC, VAAPI, or software x264) into fragmented MP4, and a Firefox extension swaps the page's
video player for one fed via MediaSource Extensions from that stream. The
low-power client (e.g. a Raspberry Pi) only ever has to hardware-decode
H.264 — never software-decode VP9/AV1 — which is where most of the
CPU/battery drain comes from.

```
[ Raspberry Pi / Firefox ]  <--H.264 fragmented MP4 (MSE)--  [ Node server ]
        extension                                             yt-dlp | ffmpeg
                                                                    ^
                                                        pulls from whatever
                                                        site yt-dlp supports
```

## 1. Server setup (the transcode machine)

Prerequisites:
- Node.js 18+
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on `PATH`
- `ffmpeg` with an H.264 encoder appropriate for the server:
  - **NVIDIA:** `h264_nvenc` (the default)
  - **AMD / Intel on Linux:** `h264_vaapi`, plus VAAPI drivers and access to a DRM render node
  - **Fallback:** `libx264` (software encoding)

```bash
cd server
npm install
npm start
```

By default it listens on `0.0.0.0:8080`. Env vars you can override:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `MAX_HEIGHT` | `1080` | Default resolution cap |
| `YTDLP_BIN` | `yt-dlp` | Path to the yt-dlp binary |
| `FFMPEG_BIN` | `ffmpeg` | Path to the ffmpeg binary |
| `VIDEO_ENCODER` | `h264_nvenc` | `h264_nvenc`, `h264_vaapi`, or `libx264` |
| `VAAPI_DEVICE` | — | Required with `VIDEO_ENCODER=h264_vaapi`; Linux DRM render node, e.g. `/dev/dri/renderD128` |

### Encoder examples

NVIDIA (default):

```bash
npm start
```

AMD or Intel on Linux with VAAPI:

```bash
VIDEO_ENCODER=h264_vaapi VAAPI_DEVICE=/dev/dri/renderD128 npm start
```

Use `ls -l /dev/dri/by-path/*-render` to map render nodes to PCI GPUs when
the machine has more than one GPU. Confirm VAAPI support with `vainfo` and
`ffmpeg -encoders | grep h264_vaapi`; the user running Featherplay must also
be able to access the selected render node.

CPU-only fallback:

```bash
VIDEO_ENCODER=libx264 npm start
```

Sanity check from any machine on the LAN (note the URL must be
percent-encoded):

```bash
curl -o test.mp4 "http://<server-ip>:8080/stream?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&res=480"
```

## 2. Extension setup (on the Raspberry Pi's Firefox)

1. Go to `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**
   → pick `extension/manifest.json`. (Temporary add-ons are removed when
   Firefox restarts — see "Making it permanent" below.)
2. Click the extension's toolbar icon.
3. Enter the server URL, e.g. `http://192.168.1.50:8080`, click **Save**
   (grant the permission prompt), then **Test connection**.
4. Open any page with a video (YouTube, Vimeo, a Twitch VOD, ...), click
   the toolbar icon again, and click **Activate on this tab**. The page's
   main `<video>` is replaced with one streaming from your server.

Activation is per-page and manual by design — every site has a different
player and a different way of handling in-app navigation (YouTube's SPA
routing, infinite-scroll players, etc.), so there's no reliable way to
auto-detect "a new video started" universally. Click **Activate** again
after navigating to a new video.

### Making it permanent
Temporary add-ons don't survive a restart and unsigned extensions can't
normally be installed permanently on release Firefox. Easiest options:
- Use **Firefox Developer Edition** or **Nightly** and set
  `xpinstall.signatures.required = false` in `about:config`, then install
  the zipped extension normally.
- Or self-sign it for permanent use via Mozilla's
  [web-ext sign](https://extensionworkshop.com/documentation/publish/self-distribution/)
  (needs a free AMO API key).

## How it behaves

- **No seeking** — this mimics a live stream, not a seekable file. Dragging
  the scrubber will stall; scrubbing support would need the server to
  restart the pipeline at an offset, which isn't implemented yet.
- **Startup latency** — expect 1-3s of black screen while yt-dlp resolves
  the source and ffmpeg spins up before the first frame arrives.
- **Concurrent streams are limited by NVENC sessions** — consumer NVIDIA
  GPUs cap concurrent NVENC encode sessions (often 3-8 depending on driver/
  card). Closing a tab kills its ffmpeg/yt-dlp process pair and frees the
  session.
- **"Main video" heuristic** — the content script picks the largest visible
  `<video>` element on the page. Sites with multiple players (e.g. autoplay
  recommendation rails) could pick the wrong one.
- **Not every yt-dlp-supported site will work end to end** — this has been
  verified against YouTube. Sites with unusual DRM, live-only formats, or
  formats yt-dlp can't merge into MKV may not transcode cleanly.

## Security note

The server has **no authentication** and will transcode any URL for any
client that can reach it — effectively an open proxy. It's meant for a
trusted home LAN only; don't port-forward it to the internet without
adding auth in front of it.
