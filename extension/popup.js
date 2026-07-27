const serverUrlEl = document.getElementById("serverUrl");
const statusEl = document.getElementById("status");

function setStatus(message, ok) {
  statusEl.textContent = message;
  statusEl.className = ok === undefined ? "" : ok ? "ok" : "err";
}

async function load() {
  const { serverUrl = "" } = await browser.storage.local.get(["serverUrl"]);
  serverUrlEl.value = serverUrl;
}

function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/*`;
}

// Must be called with no preceding await: Firefox only allows
// permissions.request() while still inside the synchronous part of a user
// input handler. It resolves immediately (no prompt) if already granted.
function ensurePermission(pattern) {
  return browser.permissions.request({ origins: [pattern] });
}

document.getElementById("save").addEventListener("click", async () => {
  const serverUrl = serverUrlEl.value.trim().replace(/\/+$/, "");
  if (!serverUrl) {
    setStatus("Enter a server URL first.", false);
    return;
  }

  let pattern;
  try {
    pattern = originPattern(serverUrl);
  } catch {
    setStatus("That doesn't look like a valid URL.", false);
    return;
  }

  const granted = await ensurePermission(pattern);
  if (!granted) {
    setStatus("Permission denied — can't reach that server without it.", false);
    return;
  }

  await browser.storage.local.set({ serverUrl });
  setStatus("Saved.", true);
});

document.getElementById("ping").addEventListener("click", async () => {
  const serverUrl = serverUrlEl.value.trim().replace(/\/+$/, "");
  if (!serverUrl) {
    setStatus("Enter a server URL first.", false);
    return;
  }

  let pattern;
  try {
    pattern = originPattern(serverUrl);
  } catch {
    setStatus("That doesn't look like a valid URL.", false);
    return;
  }

  const granted = await ensurePermission(pattern);
  if (!granted) {
    setStatus("Permission denied — can't reach that server without it.", false);
    return;
  }

  setStatus("Checking...");
  try {
    const res = await fetch(`${serverUrl}/health`, { cache: "no-store" });
    setStatus(res.ok ? "Server reachable." : `Server responded with ${res.status}.`, res.ok);
  } catch (err) {
    setStatus(`Unreachable: ${err.message}`, false);
  }
});

document.getElementById("activate").addEventListener("click", async () => {
  const { serverUrl } = await browser.storage.local.get(["serverUrl"]);
  if (!serverUrl) {
    setStatus("Save a server URL first.", false);
    return;
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("No active tab.", false);
    return;
  }

  try {
    await browser.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    setStatus("Activated on this tab.", true);
  } catch (err) {
    setStatus(`Activation failed: ${err.message}`, false);
  }
});

load();
