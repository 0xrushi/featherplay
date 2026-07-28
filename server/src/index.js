import express from "express";
import { spawn } from "node:child_process";

const PORT = process.env.PORT || 8080;
const DEFAULT_MAX_HEIGHT = process.env.MAX_HEIGHT || "1080";
const YTDLP_BIN = process.env.YTDLP_BIN || "yt-dlp";
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";

const app = express();

app.use((req, res, next) => {
  // Local-network use only: permissive CORS so the extension's popup/content
  // script can hit this from any origin without a CORS dance. Also grants
  // Local Network Access (the newer browser check, separate from ordinary
  // CORS, that gates any page reaching localhost/private-IP addresses) so
  // fetches from a moz-extension:// origin aren't blocked before ordinary
  // CORS is even evaluated.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/stream", (req, res) => {
  const sourceUrl = req.query.url;
  const maxHeight = String(req.query.res || DEFAULT_MAX_HEIGHT).replace(/\D/g, "") || DEFAULT_MAX_HEIGHT;

  if (typeof sourceUrl !== "string") {
    return res.status(400).json({ error: "missing 'url' (page URL of the video to transcode)" });
  }
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return res.status(400).json({ error: "'url' is not a valid URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return res.status(400).json({ error: "'url' must be http(s)" });
  }

  const format = `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]`;

  // yt-dlp fetches + muxes source video/audio into a streamable Matroska
  // container on stdout (no temp files, no waiting for full download).
  // yt-dlp itself supports 1000+ sites, so this isn't YouTube-specific —
  // whatever page URL the extension hands us is passed straight through.
  // The "--" stops option parsing so a URL can never be misread as a flag.
  const ytdlp = spawn(YTDLP_BIN, [
    "-f", format,
    "--merge-output-format", "mkv",
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    "-o", "-",
    "--",
    sourceUrl,
  ]);

  // ffmpeg re-encodes video to H.264 via NVENC (cheap to decode on
  // low-power/ARM clients) and remuxes to fragmented MP4 so it can be fed
  // into the extension's MediaSource pipeline. Profile/level are pinned so
  // the extension can declare an exact matching codec string
  // (avc1.640029 = High profile, level 4.1) for addSourceBuffer().
  const ffmpeg = spawn(FFMPEG_BIN, [
    "-i", "pipe:0",
    "-c:v", "h264_nvenc",
    "-preset", "p4",
    "-profile:v", "high",
    "-level:v", "4.1",
    "-rc", "vbr",
    "-cq", "23",
    "-b:v", "0",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    "pipe:1",
  ]);

  ytdlp.stdout.pipe(ffmpeg.stdin);

  ytdlp.stderr.on("data", (chunk) => process.stderr.write(`[yt-dlp ${sourceUrl}] ${chunk}`));
  // Killing ffmpeg while yt-dlp is still unwinding can make the child stdin
  // emit EPIPE. Without a listener, Node treats that as an uncaught error and
  // crashes the whole server when one browser tab disconnects.
  ffmpeg.stdin.on("error", (err) => {
    if (err.code !== "EPIPE") console.error(`[ffmpeg stdin ${sourceUrl}] ${err.message}`);
  });

  // Keep only a bounded stderr tail: ffmpeg is very chatty during a healthy
  // stream, but its final lines are essential when startup or encoding fails.
  let ffmpegStderr = "";
  ffmpeg.stderr.on("data", (chunk) => {
    ffmpegStderr = (ffmpegStderr + chunk).slice(-16_384);
  });

  let responded = false;
  res.setHeader("Content-Type", "video/mp4");

  ffmpeg.stdout.once("data", () => {
    responded = true;
  });
  ffmpeg.stdout.pipe(res);

  const cleanup = () => {
    ytdlp.kill("SIGKILL");
    ffmpeg.kill("SIGKILL");
  };

  req.on("close", cleanup); // client navigated away / stopped playback
  ytdlp.on("error", (err) => {
    console.error(`yt-dlp failed to start: ${err.message}`);
    if (!responded) res.status(500).json({ error: "yt-dlp failed to start", detail: err.message });
    cleanup();
  });
  ffmpeg.on("error", (err) => {
    console.error(`ffmpeg failed to start: ${err.message}`);
    if (!responded) res.status(500).json({ error: "ffmpeg failed to start", detail: err.message });
    cleanup();
  });
  ffmpeg.on("close", (code) => {
    if (code !== 0 && code !== null) {
      const detail = ffmpegStderr.trim();
      console.error(`[ffmpeg ${sourceUrl}] exited with code ${code}${detail ? `\n${detail}` : ""}`);
    }
    cleanup();
  });
});

app.listen(PORT, () => {
  console.log(`featherplay-server listening on http://0.0.0.0:${PORT}`);
  console.log(`Try: http://<this-machine-ip>:${PORT}/stream?url=${encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}`);
});
