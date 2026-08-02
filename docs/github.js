"use strict";
// Shared GitHub Contents API layer — used by both the dashboard (docs/dashboard/)
// and the Sideline assistant (docs/). Neither page renders board UI from here;
// dashboard.js does that. This file only knows how to read/write tasks.json
// and manage the GitHub token.

const GH_OWNER = "xavierallenhamilton-rgb";
const GH_REPO = "sideline";
const GH_BRANCH = "master";
const TASKS_PATH = "tasks/tasks.json";
const RAW_URL = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${TASKS_PATH}`;
const API_URL = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${TASKS_PATH}`;
const TOKEN_KEY = "sideline_mc_token";

let currentTasks = [];
let pendingApprove = null; // {taskId} queued while the token modal is open

// A page that wants to react to fresh task data (e.g. the dashboard's render())
// sets this. Pages that don't render a board (the assistant) can leave it unset.
let onTasksUpdated = null;

// ---------- base64 / utf-8 helpers ----------
function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str)));
}

// ---------- token storage ----------
function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t.trim());
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// ---------- toast ----------
let toastTimer = null;
function showToast(msg, isError) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

// ---------- confirm modal ----------
function confirmAction(title, body) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById("confirm-modal");
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-body").textContent = body;
    backdrop.hidden = false;
    const okBtn = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");
    function cleanup(result) {
      backdrop.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// ---------- token modal ----------
function openTokenModal() {
  document.getElementById("token-input").value = getToken();
  document.getElementById("token-modal").hidden = false;
}
function closeTokenModal() {
  document.getElementById("token-modal").hidden = true;
}

function initGithubConnectUi() {
  const connectBtn = document.getElementById("connect-btn");
  if (connectBtn) connectBtn.addEventListener("click", openTokenModal);
  const cancelBtn = document.getElementById("token-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", () => {
    pendingApprove = null;
    closeTokenModal();
  });
  const saveBtn = document.getElementById("token-save");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    const val = document.getElementById("token-input").value.trim();
    if (!val) { showToast("Paste a token first.", true); return; }
    setToken(val);
    closeTokenModal();
    updateConnectButton();
    showToast("Token saved to this browser.");
    if (pendingApprove) {
      const { taskId } = pendingApprove;
      pendingApprove = null;
      await approveTaskRemote(taskId);
    }
  });
  const clearBtn = document.getElementById("token-clear");
  if (clearBtn) clearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    clearToken();
    updateConnectButton();
    closeTokenModal();
    showToast("Token cleared.");
  });
  updateConnectButton();
}

function updateConnectButton() {
  const btn = document.getElementById("connect-btn");
  if (!btn) return;
  btn.textContent = getToken() ? "🔑 Connected" : "Connect";
}

// ---------- data fetch ----------
async function fetchTasksLive() {
  const res = await fetch(RAW_URL + "?cb=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error(`GitHub raw fetch failed: ${res.status}`);
  return res.json();
}

async function fetchTasksAuthed(token) {
  const res = await fetch(API_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("token-invalid");
    }
    throw new Error(`GitHub API fetch failed: ${res.status}`);
  }
  const json = await res.json();
  const content = b64DecodeUnicode(json.content.replace(/\n/g, ""));
  return { tasks: JSON.parse(content), sha: json.sha };
}

async function writeTasksAuthed(token, tasks, sha, message) {
  const body = JSON.stringify(tasks, null, 2) + "\n";
  const res = await fetch(API_URL, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: b64EncodeUnicode(body),
      sha,
      branch: GH_BRANCH,
    }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("token-invalid");
    if (res.status === 409) throw new Error("conflict");
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.message || `GitHub write failed: ${res.status}`);
  }
  return res.json();
}

// ---------- approve action ----------
// Returns a short status string ("approved: ..." | "cancelled: ..." | "error: ...")
// so callers (dashboard buttons, the assistant's tool-call flow) know the real
// outcome rather than assuming success.
async function approveTaskRemote(taskId) {
  const token = getToken();
  if (!token) {
    pendingApprove = { taskId };
    openTokenModal();
    return "cancelled: not connected to GitHub yet";
  }
  const task = currentTasks.find((t) => t.id === taskId);
  const label = task ? task.title : taskId;
  if (!task) return `error: no such task ${taskId}`;
  const ok = await confirmAction(
    "Approve this task?",
    `This writes a real commit to tasks/tasks.json in the sideline repo, approving "${label}" (${taskId}). Your local clone won't see this until you git pull.`
  );
  if (!ok) return "cancelled: user declined the confirmation dialog";

  showToast("Approving…");
  try {
    const { tasks, sha } = await fetchTasksAuthed(token);
    const t = tasks.find((x) => x.id === taskId);
    if (!t) throw new Error(`Task ${taskId} not found in live tasks.json`);
    const nowIso = new Date().toISOString();
    t.status = "approved";
    t.human_approval = t.human_approval || { required: true, status: "pending", notes: "" };
    t.human_approval.status = "approved";
    t.history = t.history || [];
    t.history.push({ at: nowIso, event: "approved", by: "Xavier (Mission Control)" });

    await writeTasksAuthed(token, tasks, sha, `Approve ${taskId} via Mission Control`);
    showToast("Approved — committed to GitHub.");
    currentTasks = tasks;
    if (typeof onTasksUpdated === "function") onTasksUpdated(tasks);
    return `approved: ${label} (${taskId}) is now approved and committed`;
  } catch (err) {
    if (err.message === "token-invalid") {
      showToast("Token invalid or missing write access. Reconnect.", true);
      clearToken();
      updateConnectButton();
      return "error: GitHub token invalid or lacks write access";
    } else if (err.message === "conflict") {
      showToast("Board changed elsewhere — refreshed, try again.", true);
      if (typeof loadAndRender === "function") await loadAndRender();
      return "error: board changed elsewhere, refreshed — ask the user to retry";
    } else {
      showToast("Approve failed: " + err.message, true);
      return "error: " + err.message;
    }
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = String(s == null ? "" : s);
  return div.innerHTML;
}
