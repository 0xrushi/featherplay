(async () => {
  // Guard against double-injection if the user clicks "Activate" twice.
  if (window.__yrtActive) return;
  window.__yrtActive = true;

  const { serverUrl } = await browser.storage.local.get(["serverUrl"]);
  if (!serverUrl) {
    console.error("[featherplay] no server URL configured");
    return;
  }

  // Must match the -profile:v/-level:v pinned in the server's ffmpeg command.
  const MIME_TYPE = 'video/mp4; codecs="avc1.640029, mp4a.40.2"';
  if (!window.MediaSource || !MediaSource.isTypeSupported(MIME_TYPE)) {
    console.error("[featherplay] MediaSource / codec not supported:", MIME_TYPE);
    return;
  }

  // Sites vary wildly in player markup, so instead of a site-specific
  // selector we just pick the largest visible <video> on the page — that's
  // reliably the main player on YouTube, Vimeo, Twitch VODs, etc.
  function findMainVideo() {
    const candidates = Array.from(document.querySelectorAll("video")).filter(
      (v) => v.offsetWidth > 0 && v.offsetHeight > 0,
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((best, v) =>
      v.offsetWidth * v.offsetHeight > best.offsetWidth * best.offsetHeight ? v : best,
    );
  }

  function waitForVideo(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const existing = findMainVideo();
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const found = findMainVideo();
        if (found) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(found);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error("No <video> element found on this page."));
      }, timeoutMs);
    });
  }

  // Pumps raw response bytes into the SourceBuffer as they arrive. Chunks
  // don't need to align to ISO-BMFF box boundaries — the browser's demuxer
  // buffers partial boxes across appendBuffer() calls.
  function pumpStream(reader, sourceBuffer, mediaSource) {
    function push() {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            if (mediaSource.readyState === "open") {
              try {
                mediaSource.endOfStream();
              } catch {
                /* video element may already be gone */
              }
            }
            return;
          }
          appendChunk(value);
        })
        .catch((err) => {
          if (err.name !== "AbortError") console.error("[featherplay] read failed:", err);
        });
    }

    function appendChunk(chunk) {
      sourceBuffer.addEventListener("updateend", push, { once: true });
      try {
        sourceBuffer.appendBuffer(chunk);
      } catch (err) {
        console.error("[featherplay] appendBuffer failed:", err);
      }
    }

    push();
  }

  let nativeVideo;
  try {
    nativeVideo = await waitForVideo();
  } catch (err) {
    console.error("[featherplay]", err.message);
    return;
  }

  // Hiding the native video doesn't stop it — it keeps playing (and making
  // sound) underneath unless paused/muted too. Some players auto-resume
  // their own video, so keep re-pausing it.
  nativeVideo.muted = true;
  nativeVideo.pause();
  nativeVideo.addEventListener("play", () => nativeVideo.pause());

  // The site's own player chrome (play button, controls overlay) usually
  // lives in a wrapper around the <video>, not inside it, so hiding just the
  // video leaves that whole wrapper — controls and all — still visible.
  // Climb up from the video to the tightest-fitting ancestor that's still
  // roughly the video's own size; that's reliably "the player box" as a
  // whole, without also swallowing unrelated page content around it. Use
  // visibility (not display) so it stays in the layout and
  // getBoundingClientRect() below keeps working for rect tracking.
  function findPlayerBox(video) {
    const videoRect = video.getBoundingClientRect();
    let el = video;
    while (el.parentElement) {
      const parentRect = el.parentElement.getBoundingClientRect();
      const grew = parentRect.width > videoRect.width * 1.05 || parentRect.height > videoRect.height * 1.05;
      if (grew) break;
      el = el.parentElement;
    }
    return el;
  }
  findPlayerBox(nativeVideo).classList.add("yrt-native-hidden");

  // Overlay our video as a fixed, max-z-index element tracking the native
  // video's exact rect — that reliably sits above whatever the page draws
  // underneath, regardless of its DOM structure.
  const customVideo = document.createElement("video");
  customVideo.className = "yrt-video";
  customVideo.controls = true;
  customVideo.autoplay = true;
  document.body.appendChild(customVideo);

  function syncOverlayRect() {
    const rect = nativeVideo.getBoundingClientRect();
    customVideo.style.top = `${rect.top}px`;
    customVideo.style.left = `${rect.left}px`;
    customVideo.style.width = `${rect.width}px`;
    customVideo.style.height = `${rect.height}px`;
  }

  syncOverlayRect();
  window.addEventListener("resize", syncOverlayRect);
  window.addEventListener("scroll", syncOverlayRect, true);
  new ResizeObserver(syncOverlayRect).observe(nativeVideo);

  const abortController = new AbortController();
  const mediaSource = new MediaSource();
  customVideo.src = URL.createObjectURL(mediaSource);

  mediaSource.addEventListener(
    "sourceopen",
    async () => {
      let sourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(MIME_TYPE);
      } catch (err) {
        console.error("[featherplay] addSourceBuffer failed:", err);
        return;
      }

      const streamUrl = `${serverUrl}/stream?url=${encodeURIComponent(location.href)}`;
      let response;
      try {
        response = await fetch(streamUrl, { signal: abortController.signal });
      } catch (err) {
        if (err.name !== "AbortError") console.error("[featherplay] fetch failed:", err);
        return;
      }
      if (!response.ok || !response.body) {
        console.error("[featherplay] bad response:", response.status);
        return;
      }

      pumpStream(response.body.getReader(), sourceBuffer, mediaSource);
    },
    { once: true },
  );
})();
