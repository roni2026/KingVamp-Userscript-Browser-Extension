// KingVamp Bridge — ISOLATED world content script
window.addEventListener('message', async (e) => {
  if (!e.data?.__kv) return;
  const { rid, type, data, scriptId } = e.data;
  try {
    const result = await chrome.runtime.sendMessage({ __kvApi: true, type, data, scriptId });
    window.postMessage({ __kvR: rid, val: result?.val, err: result?.err }, '*');
  } catch (err) {
    window.postMessage({ __kvR: rid, err: err.message }, '*');
  }
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.__kvXR !== undefined || msg.__kvVC || msg.__kvCmd) {
    window.postMessage(msg, '*');
  }
});
