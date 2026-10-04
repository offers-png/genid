const domainEl = document.getElementById("domain");
const apiKeyEl = document.getElementById("apiKey");
const statusEl = document.getElementById("status");

async function load() {
  const { genidDomain, genidApiKey } = await chrome.storage.local.get([
    "genidDomain",
    "genidApiKey",
  ]);
  domainEl.value = genidDomain || "genid.onrender.com";
  apiKeyEl.value = genidApiKey || "";
}

document.getElementById("save").addEventListener("click", async () => {
  const genidDomain = domainEl.value.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const genidApiKey = apiKeyEl.value.trim();
  await chrome.storage.local.set({ genidDomain, genidApiKey });
  statusEl.textContent = "Saved.";
  setTimeout(() => (statusEl.textContent = ""), 2000);
});

load();
