// GenID Protocol — Certify Image extension
// Background service worker (Manifest V3)

const MENU_ID = "genid-certify-image";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Certify with GenID",
    contexts: ["image"],
  });
});

async function getSettings() {
  const { genidDomain, genidApiKey } = await chrome.storage.local.get([
    "genidDomain",
    "genidApiKey",
  ]);
  return {
    genidDomain: genidDomain || "genid.onrender.com",
    genidApiKey: genidApiKey || "",
  };
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

// URL.createObjectURL is not available inside a Manifest V3 background
// service worker (no DOM/window context) — chrome.downloads.download
// accepts a data: URL directly instead, which works fine here.
function base64ToDataUrl(base64, mime) {
  return `data:${mime};base64,${base64}`;
}

async function certifyImage(srcUrl, tabId) {
  const notifId = `genid-${Date.now()}`;
  const { genidDomain, genidApiKey } = await getSettings();

  if (!genidApiKey) {
    notify(notifId, "GenID: API key missing", "Open the extension options and add your gk_live_ API key first.");
    chrome.runtime.openOptionsPage();
    return;
  }

  try {
    notify(notifId, "GenID", "Fetching image and starting certification…");

    // 1. Fetch the image the user right-clicked. Extension host_permissions
    // let this bypass page-level CORS restrictions.
    const imgResp = await fetch(srcUrl);
    if (!imgResp.ok) {
      throw new Error(`Could not fetch the image (HTTP ${imgResp.status}). It may require the page's own session to load.`);
    }
    const imgBlob = await imgResp.blob();
    const contentType = imgBlob.type || "image/png";
    const ext = contentType.includes("jpeg") ? "jpg" : contentType.split("/")[1] || "png";
    const fileName = `genid-source.${ext}`;

    // 2. Create a GenID session from the uploaded image.
    const form = new FormData();
    form.append("image", imgBlob, fileName);

    const base = `https://${genidDomain}`;
    const sessionResp = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${genidApiKey}` },
      body: form,
    });
    const sessionData = await sessionResp.json().catch(() => ({}));
    if (!sessionResp.ok) {
      throw new Error(sessionData?.error || `Session creation failed (HTTP ${sessionResp.status})`);
    }

    notify(notifId, "GenID", "Session created — anchoring + generating certificate…");

    // 3. Finalize — Polygon anchor, C2PA embed, certificate PDF.
    const finalizeResp = await fetch(`${base}/api/session/${sessionData.sessionId}/finalize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${genidApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const finalizeData = await finalizeResp.json().catch(() => ({}));
    if (!finalizeResp.ok) {
      throw new Error(finalizeData?.error || `Finalize failed (HTTP ${finalizeResp.status})`);
    }

    // 4. Download the certificate PDF automatically.
    const pdfUrl = base64ToDataUrl(finalizeData.pdfBase64, "application/pdf");
    await chrome.downloads.download({
      url: pdfUrl,
      filename: `genid-certificate-${sessionData.sessionId}.pdf`,
      saveAs: false,
    });

    // Stash the last result so the popup can show it.
    await chrome.storage.local.set({
      lastResult: {
        sessionId: sessionData.sessionId,
        verifyUrl: finalizeData.verifyUrl,
        polygonAnchorTx: finalizeData.polygonAnchorTx,
        c2paManifestEmbedded: finalizeData.c2paManifestEmbedded,
        timestamp: Date.now(),
      },
    });

    notify(notifId, "GenID: Certified ✓", "Certificate downloaded. Click to verify online.");
  } catch (err) {
    console.error("GenID certify failed:", err);
    notify(notifId, "GenID: Failed", err.message || "Something went wrong.");
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && info.srcUrl) {
    certifyImage(info.srcUrl, tab?.id);
  }
});

chrome.notifications.onClicked.addListener(async (notifId) => {
  const { lastResult } = await chrome.storage.local.get("lastResult");
  if (lastResult?.verifyUrl) {
    chrome.tabs.create({ url: lastResult.verifyUrl });
  }
});
