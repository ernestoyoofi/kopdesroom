const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const statusText = document.getElementById("status-text");
const progressRow = document.getElementById("progress-row");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const errorContainer = document.getElementById("error-container");
const errorText = document.getElementById("error-text");
const retryBtn = document.getElementById("retry-btn");
const clearRow = document.getElementById("clear-row");
const clearDataBtn = document.getElementById("clear-data-btn");

function setStatus(msg) {
  statusText.textContent = msg;
}

function showProgress(current, total, file) {
  progressRow.style.display = "flex";
  clearRow.style.display = "flex";
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = pct + "%";
  progressText.textContent = file
    ? `${file} (${current}/${total})`
    : `Preparing...`;
}

function showError(msg) {
  errorContainer.style.display = "block";
  clearRow.style.display = "flex";
  errorText.textContent = msg;
}

function hideError() {
  errorContainer.style.display = "none";
  clearRow.style.display = "none";
}

async function loadApp() {
  setStatus("Checking for updates...");

  try {
    const result = await invoke("sync_assets");

    if (result.ready) {
      setStatus("Starting Kopdesroom...");
      await invoke("load_main_webview");
    } else {
      showError("Please connect to the internet to download the required data.");
    }
  } catch (err) {
    const errorMsg = typeof err === "string" ? err : JSON.stringify(err);
    hideError();
    showError(errorMsg);
  }
}

async function init() {
  try {
    await listen("sync-progress", (event) => {
      const { current, total, file, action } = event.payload;
      showProgress(current, total, file);
    });
  } catch (e) {
    console.warn("Could not listen to progress events", e);
  }

  function resetUI() {
    hideError();
    clearRow.style.display = "none";
    progressRow.style.display = "none";
    progressBar.style.width = "0%";
  }

  retryBtn.addEventListener("click", () => {
    resetUI();
    setStatus("Checking for updates...");
    loadApp();
  });

  clearDataBtn.addEventListener("click", async () => {
    resetUI();
    setStatus("Clearing local data...");
    try {
      await invoke("clear_assets");
    } catch (e) {
      console.error("Clear failed:", e);
    }
    loadApp();
  });

  await loadApp();
}

init();
