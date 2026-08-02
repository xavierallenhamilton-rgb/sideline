"use strict";
// Board rendering only. GitHub fetch/write/approve logic lives in ../github.js;
// this file just turns tasks.json into the ticket-pad UI and re-renders when
// approveTaskRemote() (in github.js) reports a successful write.

onTasksUpdated = render;

function statusRailClass(status) {
  if (status === "approved" || status === "delivered") return "done";
  if (["review_ready", "claimed", "in_progress"].includes(status)) return "pending";
  if (["blocked", "changes_requested", "escalated_to_human", "failed"].includes(status)) return "blocked";
  return "idle";
}

function statusStampClass(status) {
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

function buildLeadCard(slug, tasksForLead, sweepApproved) {
  const info = LEAD_INFO[slug] || {
    name: slug,
    meta: "",
    site: null,
    repo: null,
  };
  const card = document.createElement("div");
  card.className = "ticket";

  const serial = document.createElement("div");
  serial.className = "ticket-serial";
  serial.textContent = "No. " + leadSerial(slug);
  card.appendChild(serial);

  const tear = document.createElement("div");
  tear.className = "tear";
  card.appendChild(tear);

  const reviewReady = tasksForLead.filter((t) => t.status === "review_ready").length;
  const stampCls = reviewReady > 0 ? "warn" : "good";
  const stampText = reviewReady > 0 ? `${reviewReady} pending` : "all clear";

  const top = document.createElement("div");
  top.className = "ticket-top";
  top.innerHTML = `
    <div>
      <div class="ticket-title">${escapeHtml(info.name)}</div>
      <div class="ticket-meta">${escapeHtml(info.meta)}</div>
    </div>
    <span class="stamp ${stampCls}">${stampText}</span>
  `;
  card.appendChild(top);
  card.appendChild(buildRail(tasksForLead, sweepApproved));

  const artifacts = document.createElement("div");
  artifacts.className = "ticket-artifacts";
  tasksForLead.forEach((t) => {
    const idSpan = document.createElement("span");
    idSpan.className = "mono";
    idSpan.style.color = "var(--ink-faint)";
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

let lastStatsSignature = null;

function leadSerial(slug) {
  const idx = Object.keys(LEAD_INFO).indexOf(slug);
  const n = idx >= 0 ? idx + 1 : Object.keys(LEAD_INFO).length + 1;
  return "SL-" + String(n).padStart(3, "0");
}

function render(tasks) {
  currentTasks = tasks;

  const total = tasks.length;
  const approved = tasks.filter((t) => t.status === "approved" || t.status === "delivered").length;
  const reviewReady = tasks.filter((t) => t.status === "review_ready").length;
  const leadSlugs = [...new Set(tasks.map((t) => t.lead).filter(Boolean))];

  const signature = `${total}|${approved}|${reviewReady}|${leadSlugs.length}`;
  const changed = lastStatsSignature !== null && lastStatsSignature !== signature;
  lastStatsSignature = signature;

  const flash = changed ? " flash" : "";
  const statsEl = document.getElementById("stats");
  statsEl.innerHTML = `
    <div class="stat"><div class="stat-num${flash}">${total}</div><div class="stat-label">Total tasks</div></div>
    <div class="stat is-good"><div class="stat-num${flash}">${approved}</div><div class="stat-label">Approved</div></div>
    <div class="stat is-warn"><div class="stat-num${flash}">${reviewReady}</div><div class="stat-label">Review ready</div></div>
    <div class="stat is-accent"><div class="stat-num${flash}">${leadSlugs.length}</div><div class="stat-label">Leads in flight</div></div>
  `;

  const serialEl = document.getElementById("serial-num");
  if (serialEl) serialEl.textContent = "SL-" + String(total).padStart(3, "0");

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
        <div class="ticket-serial">No. SL-000</div>
        <div class="tear"></div>
        <div class="ticket-top">
          <div>
            <div class="ticket-id mono">${t.id}</div>
            <div class="ticket-title">${escapeHtml(t.title)}</div>
            <div class="ticket-meta">${escapeHtml(t.assigned_role)} · ${escapeHtml(t.type)}</div>
          </div>
          <span class="stamp ${statusStampClass(t.status)}">${escapeHtml(t.status)}</span>
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

// ---------- init ----------
initGithubConnectUi();
loadAndRender();
setInterval(loadAndRender, 60000);
