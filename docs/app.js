"use strict";

const GH_OWNER = "xavierallenhamilton-rgb";
const GH_REPO = "sideline";
const GH_BRANCH = "master";
const TASKS_PATH = "tasks/tasks.json";
const RAW_URL = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${TASKS_PATH}`;
const API_URL = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${TASKS_PATH}`;
const TOKEN_KEY = "sideline_mc_token";

let currentTasks = [];
let pendingApprove = null; // {taskId} queued while the token modal is open

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

document.getElementById("connect-btn").addEventListener("click", openTokenModal);
document.getElementById("token-cancel").addEventListener("click", () => {
  pendingApprove = null;
  closeTokenModal();
});
document.getElementById("token-save").addEventListener("click", async () => {
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
document.getElementById("token-clear").addEventListener("click", (e) => {
  e.preventDefault();
  clearToken();
  updateConnectButton();
  closeTokenModal();
  showToast("Token cleared.");
});
function updateConnectButton() {
  const btn = document.getElementById("connect-btn");
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
async function approveTaskRemote(taskId) {
  const token = getToken();
  if (!token) {
    pendingApprove = { taskId };
    openTokenModal();
    return;
  }
  const task = currentTasks.find((t) => t.id === taskId);
  const label = task ? task.title : taskId;
  const ok = await confirmAction(
    "Approve this task?",
    `This writes a real commit to tasks/tasks.json in the sideline repo, approving "${label}" (${taskId}). Your local clone won't see this until you git pull.`
  );
  if (!ok) return;

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
    render(currentTasks);
  } catch (err) {
    if (err.message === "token-invalid") {
      showToast("Token invalid or missing write access. Reconnect.", true);
      clearToken();
      updateConnectButton();
    } else if (err.message === "conflict") {
      showToast("Board changed elsewhere — refreshed, try again.", true);
      await loadAndRender();
    } else {
      showToast("Approve failed: " + err.message, true);
    }
  }
}

// ---------- rendering ----------
function statusRailClass(status) {
  if (status === "approved" || status === "delivered") return "done";
  if (["review_ready", "claimed", "in_progress"].includes(status)) return "pending";
  if (["blocked", "changes_requested", "escalated_to_human", "failed"].includes(status)) return "blocked";
  return "idle";
}

function statusPillClass(status) {
  if (status === "approved" || status === "delivered") return "good";
  if (["review_ready", "claimed", "in_progress"].includes(status)) return "warn";
  if (["blocked", "changes_requested", "escalated_to_human", "failed"].includes(status)) return "crit";
  return "idle";
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function buildRail(tasksForLead, sweepApproved) {
  const rail = document.createElement("div");
  rail.className = "rail";
  PIPELINE_STAGES.forEach((stage, i) => {
    const stageTasks = tasksForLead.filter((t) => TYPE_TO_STAGE[t.type] === stage);
    let cls = "idle";
    if (stage === "SCOUT" && sweepApproved && stageTasks.length === 0) cls = "done";
    if (stageTasks.length > 0) {
      const order = { blocked: 3, pending: 2, done: 1, idle: 0 };
      cls = stageTasks
        .map((t) => statusRailClass(t.status))
        .reduce((best, c) => (order[c] > order[best] ? c : best), "idle");
    }
    const node = document.createElement("div");
    node.className = `rail-node ${cls}`;
    node.innerHTML = `<div class="rail-dot"></div><div class="rail-label">${stage}</div>`;
    rail.appendChild(node);
    if (i < PIPELINE_STAGES.length - 1) {
      const line = document.createElement("div");
      line.className = `rail-line ${cls === "done" ? "done" : cls === "pending" ? "pending" : ""}`;
      rail.appendChild(line);
    }
  });
  return rail;
}

function buildHistoryDetails(tasksForLead) {
  const rows = [];
  tasksForLead.forEach((t) => {
    (t.history || []).forEach((h) => {
      rows.push({ ...h, taskId: t.id });
    });
  });
  rows.sort((a, b) => new Date(a.at) - new Date(b.at));
  const details = document.createElement("details");
  details.className = "history";
  const summary = document.createElement("summary");
  summary.textContent = "Full history";
  details.appendChild(summary);
  const log = document.createElement("div");
  log.className = "history-log";
  rows.forEach((r) => {
    const row = document.createElement("div");
    row.className = "history-row";
    row.innerHTML = `<span class="history-time">${fmtTime(r.at)}</span><span class="history-actor">${escapeHtml(r.by)}</span><span class="history-note">${escapeHtml(r.event)}${r.note ? " — " + escapeHtml(r.note) : ""}</span>`;
    log.appendChild(row);
  });
  details.appendChild(log);
  return details;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = String(s == null ? "" : s);
  return div.innerHTML;
}

function buildLeadCard(slug, tasksForLead, sweepApproved) {
  const info = LEAD_INFO[slug] || {
    name: slug,
    meta: "",
    site: null,
    repo: null,
  };
  const card = document.createElement("div");
  card.className = "ticket";

  const reviewReady = tasksForLead.filter((t) => t.status === "review_ready").length;
  const pillCls = reviewReady > 0 ? "warn" : "good";
  const pillText = reviewReady > 0 ? `${reviewReady} review_ready` : "all approved";

  const top = document.createElement("div");
  top.className = "ticket-top";
  top.innerHTML = `
    <div>
      <div class="ticket-title">${escapeHtml(info.name)}</div>
      <div class="ticket-meta">${escapeHtml(info.meta)}</div>
    </div>
    <span class="pill ${pillCls}">${pillText}</span>
  `;
  card.appendChild(top);
  card.appendChild(buildRail(tasksForLead, sweepApproved));

  const artifacts = document.createElement("div");
  artifacts.className = "ticket-artifacts";
  tasksForLead.forEach((t) => {
    const idSpan = document.createElement("span");
    idSpan.className = "mono";
    idSpan.style.color = "var(--ink-muted)";
    idSpan.textContent = t.id;
    artifacts.appendChild(idSpan);
    const typeSpan = document.createElement("span");
    typeSpan.textContent = t.type.replace(/_/g, " ");
    artifacts.appendChild(typeSpan);
  });
  if (info.site) {
    const a = document.createElement("a");
    a.href = info.site; a.target = "_blank"; a.rel = "noopener";
    a.textContent = "live site ↗";
    artifacts.appendChild(a);
  }
  if (info.repo) {
    const a = document.createElement("a");
    a.href = info.repo; a.target = "_blank"; a.rel = "noopener";
    a.textContent = "repo ↗";
    artifacts.appendChild(a);
  }
  card.appendChild(artifacts);

  const actions = document.createElement("div");
  actions.className = "ticket-actions";
  tasksForLead
    .filter((t) => t.status === "review_ready" || t.status === "claimed" || t.status === "in_progress")
    .forEach((t) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-approve";
      btn.textContent = `✓ Approve ${TYPE_TO_STAGE[t.type] || t.type}`;
      btn.addEventListener("click", () => approveTaskRemote(t.id));
      actions.appendChild(btn);
    });
  if (actions.children.length) card.appendChild(actions);

  card.appendChild(buildHistoryDetails(tasksForLead));
  return card;
}

function render(tasks) {
  currentTasks = tasks;

  const total = tasks.length;
  const approved = tasks.filter((t) => t.status === "approved" || t.status === "delivered").length;
  const reviewReady = tasks.filter((t) => t.status === "review_ready").length;
  const leadSlugs = [...new Set(tasks.map((t) => t.lead).filter(Boolean))];

  const statsEl = document.getElementById("stats");
  statsEl.innerHTML = `
    <div class="stat"><div class="stat-num">${total}</div><div class="stat-label">Total tasks</div></div>
    <div class="stat is-good"><div class="stat-num">${approved}</div><div class="stat-label">Approved</div></div>
    <div class="stat is-warn"><div class="stat-num">${reviewReady}</div><div class="stat-label">Review ready</div></div>
    <div class="stat is-accent"><div class="stat-num">${leadSlugs.length}</div><div class="stat-label">Leads in flight</div></div>
  `;

  const originTasks = tasks.filter((t) => !t.lead);
  const originEl = document.getElementById("origin-section");
  originEl.innerHTML = "";
  if (originTasks.length) {
    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML = `<h2>Origin</h2><span class="count">${originTasks.length} task${originTasks.length === 1 ? "" : "s"}</span>`;
    originEl.appendChild(head);
    originTasks.forEach((t) => {
      const card = document.createElement("div");
      card.className = "ticket";
      card.innerHTML = `
        <div class="ticket-top">
          <div>
            <div class="ticket-id mono">${t.id}</div>
            <div class="ticket-title">${escapeHtml(t.title)}</div>
            <div class="ticket-meta">${escapeHtml(t.assigned_role)} · ${escapeHtml(t.type)}</div>
          </div>
          <span class="pill ${statusPillClass(t.status)}">${escapeHtml(t.status)}</span>
        </div>
        <div class="ticket-body">${escapeHtml(t.spec)}</div>
      `;
      card.appendChild(buildHistoryDetails([t]));
      originEl.appendChild(card);
    });
  }

  const sweepApproved = originTasks.some((t) => t.type === "prospect" && t.status === "approved");

  const leadsEl = document.getElementById("leads");
  leadsEl.innerHTML = "";
  const orderedSlugs = [...new Set([...Object.keys(LEAD_INFO), ...leadSlugs])].filter((s) => leadSlugs.includes(s));
  orderedSlugs.forEach((slug) => {
    const tasksForLead = tasks.filter((t) => t.lead === slug);
    leadsEl.appendChild(buildLeadCard(slug, tasksForLead, sweepApproved));
  });
  document.getElementById("leads-count").textContent =
    `${orderedSlugs.length} pipeline${orderedSlugs.length === 1 ? "" : "s"} · ${reviewReady} task${reviewReady === 1 ? "" : "s"} review_ready`;
}

// ---------- load ----------
async function loadAndRender() {
  const statusEl = document.getElementById("status-line");
  statusEl.classList.remove("error");
  statusEl.textContent = "Loading live task board…";
  try {
    const tasks = await fetchTasksLive();
    render(tasks);
    statusEl.textContent = `Last synced ${new Date().toLocaleTimeString()} · live from github.com/${GH_OWNER}/${GH_REPO}`;
  } catch (err) {
    statusEl.classList.add("error");
    statusEl.textContent = "Failed to load live task board: " + err.message;
  }
}

document.getElementById("refresh-btn").addEventListener("click", loadAndRender);

// ---------- voice: narrate ----------
function buildNarration() {
  const total = currentTasks.length;
  const approved = currentTasks.filter((t) => t.status === "approved" || t.status === "delivered").length;
  const reviewReady = currentTasks.filter((t) => t.status === "review_ready").length;
  const leadSlugs = [...new Set(currentTasks.map((t) => t.lead).filter(Boolean))];
  let text = `Sideline mission control. ${total} total tasks. ${approved} approved. ${reviewReady} review ready, across ${leadSlugs.length} leads.`;
  leadSlugs.forEach((slug) => {
    const info = LEAD_INFO[slug];
    const name = info ? info.name : slug;
    const pending = currentTasks.filter((t) => t.lead === slug && t.status === "review_ready").length;
    if (pending > 0) text += ` ${name}: ${pending} pending approval.`;
  });
  return text;
}

document.getElementById("narrate-btn").addEventListener("click", () => {
  if (!("speechSynthesis" in window)) {
    showToast("Speech synthesis isn't supported in this browser.", true);
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(buildNarration());
  window.speechSynthesis.speak(utter);
});

// ---------- voice: listen for approve commands ----------
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const listenBtn = document.getElementById("listen-btn");
if (!SpeechRecognitionImpl) {
  listenBtn.disabled = true;
  listenBtn.title = "Speech recognition isn't supported in this browser.";
}

function matchLeadFromTranscript(transcript) {
  const lower = transcript.toLowerCase();
  const KEYWORDS = {
    "julies-barbershop-campbell": ["julie", "barbershop"],
    "new-view-landscaping-campbell": ["new view", "landscap"],
    "amandas-mobile-pet-grooming-campbell": ["amanda", "pet groom", "grooming"],
    "rochas-house-cleaning-campbell": ["rocha"],
    "jr-cleaning-service-campbell": ["jr cleaning", "j r cleaning"],
    "blue-pool-services-campbell": ["blue pool", "pool service"],
  };
  for (const [slug, kws] of Object.entries(KEYWORDS)) {
    if (kws.some((k) => lower.includes(k))) return slug;
  }
  return null;
}

listenBtn.addEventListener("click", () => {
  const recog = new SpeechRecognitionImpl();
  recog.lang = "en-US";
  recog.interimResults = false;
  recog.maxAlternatives = 1;
  showToast("Listening…");
  recog.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    showToast(`Heard: "${transcript}"`);
    const slug = matchLeadFromTranscript(transcript);
    const wantsApprove = /approve/i.test(transcript);
    if (!slug || !wantsApprove) {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(
          "Didn't catch an approval command for a known lead. Try: approve Julie's Barbershop."
        ));
      }
      return;
    }
    const pending = currentTasks.filter((t) => t.lead === slug && t.status === "review_ready");
    const info = LEAD_INFO[slug];
    const name = info ? info.name : slug;
    if (pending.length === 0) {
      showToast(`${name} has nothing pending approval.`);
      return;
    }
    const ok = await confirmAction(
      `Approve ${name}?`,
      `Voice command matched ${pending.length} pending task(s) for ${name}: ${pending.map((t) => t.type).join(", ")}. Confirm to approve all of them.`
    );
    if (!ok) return;
    for (const t of pending) {
      await approveTaskRemote(t.id);
    }
  };
  recog.onerror = (e) => showToast("Voice recognition error: " + e.error, true);
  recog.start();
});

// ---------- init ----------
updateConnectButton();
loadAndRender();
setInterval(loadAndRender, 60000);
