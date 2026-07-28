// Manifest V3 content scripts make fetches in the web page's security
// context, so an HTTPS video page blocks requests to an HTTP server on the
// LAN as mixed content. The background page has the extension's granted host
// permissions and can make the request on the content script's behalf.
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "featherplay-stream") return;

  let abortController;
  let reader;
  let reading = false;
  let disconnected = false;

  function send(message) {
    if (disconnected) return;
    try {
      port.postMessage(message);
    } catch {
      disconnected = true;
      abortController?.abort();
    }
  }

  async function start(url) {
    if (abortController) {
      send({ type: "error", message: "A stream is already active on this connection." });
      return;
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      send({ type: "error", message: "The stream URL is invalid." });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      send({ type: "error", message: "The stream URL must use HTTP or HTTPS." });
      return;
    }

    abortController = new AbortController();
    try {
      const response = await fetch(parsed.href, {
        cache: "no-store",
        signal: abortController.signal,
      });
      if (!response.ok || !response.body) {
        send({ type: "error", message: `Server responded with ${response.status}.` });
        return;
      }

      reader = response.body.getReader();
      send({ type: "ready" });
    } catch (err) {
      if (err.name !== "AbortError") {
        send({ type: "error", message: `Stream request failed: ${err.message}` });
      }
    }
  }

  async function readNext() {
    if (!reader || reading || disconnected) return;
    reading = true;
    try {
      const { done, value } = await reader.read();
      if (done) {
        reader = undefined;
        send({ type: "end" });
        return;
      }

      // A Port message is structured-cloned, so send only the populated
      // portion if the Uint8Array is a view into a larger backing buffer.
      const chunk =
        value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
          ? value.buffer
          : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      send({ type: "chunk", chunk });
    } catch (err) {
      if (err.name !== "AbortError") {
        send({ type: "error", message: `Stream read failed: ${err.message}` });
      }
    } finally {
      reading = false;
    }
  }

  port.onMessage.addListener((message) => {
    if (message?.type === "start") {
      start(message.url);
    } else if (message?.type === "pull") {
      readNext();
    }
  });

  port.onDisconnect.addListener(() => {
    disconnected = true;
    abortController?.abort();
    reader?.cancel().catch(() => {});
  });
});
