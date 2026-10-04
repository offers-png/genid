document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

(async () => {
  const { lastResult } = await chrome.storage.local.get("lastResult");
  if (!lastResult) return;
  const box = document.getElementById("resultBox");
  box.className = "result";
  const when = new Date(lastResult.timestamp).toLocaleTimeString();
  box.innerHTML = `
    <div><strong>Last certified:</strong> ${when}</div>
    <div>Polygon tx: ${lastResult.polygonAnchorTx ? lastResult.polygonAnchorTx.slice(0, 14) + "…" : "pending"}</div>
    <div>C2PA embedded: ${lastResult.c2paManifestEmbedded ? "yes" : "no"}</div>
    <div><a href="${lastResult.verifyUrl}" target="_blank">Verify certificate →</a></div>
  `;
})();
