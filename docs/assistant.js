"use strict";
// Sideline — the voice/chat assistant. No board UI lives on this page (that's
// docs/dashboard/); this file only needs the task list as context for the
// model and to resolve task IDs when approving.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_KEY_STORAGE = "sideline_mc_ai_key";
const AI_MODEL_STORAGE = "sideline_mc_ai_model";
const DEFAULT_AI_MODEL = "meta-llama/llama-3.1-8b-instruct:free";

let aiMessages = []; // running conversation (system prompt is prepended fresh each call)
let pendingAiSend = null; // queued user text while the AI-connect modal is open

function getAiKey() { return localStorage.getItem(AI_KEY_STORAGE) || ""; }
function setAiKey(k) { localStorage.setItem(AI_KEY_STORAGE, k.trim()); }
function clearAiKey() { localStorage.removeItem(AI_KEY_STORAGE); }
function getAiModel() { return localStorage.getItem(AI_MODEL_STORAGE) || DEFAULT_AI_MODEL; }
function setAiModel(m) { localStorage.setItem(AI_MODEL_STORAGE, (m || DEFAULT_AI_MODEL).trim()); }

function openAiModal() {
  document.getElementById("ai-key-input").value = getAiKey();
  document.getElementById("ai-model-input").value = getAiModel();
  document.getElementById("ai-modal").hidden = false;
}
function closeAiModal() {
  document.getElementById("ai-modal").hidden = true;
}
document.getElementById("ai-cancel").addEventListener("click", () => {
  pendingAiSend = null;
  closeAiModal();
});
document.getElementById("ai-save").addEventListener("click", async () => {
  const key = document.getElementById("ai-key-input").value.trim();
  if (!key) { showToast("Paste an OpenRouter key first.", true); return; }
  setAiKey(key);
  setAiModel(document.getElementById("ai-model-input").value.trim());
  closeAiModal();
  showToast("Assistant connected.");
  updateAiConnectButton();
  if (pendingAiSend) {
    const text = pendingAiSend;
    pendingAiSend = null;
    await sendToAssistant(text);
  }
});
document.getElementById("ai-clear").addEventListener("click", (e) => {
  e.preventDefault();
  clearAiKey();
  updateAiConnectButton();
  closeAiModal();
  showToast("Assistant key cleared.");
});
function updateAiConnectButton() {
  const btn = document.getElementById("ai-connect-btn");
  if (!btn) return;
  btn.textContent = getAiKey() ? "🤖 Connected" : "Connect assistant";
}
document.getElementById("ai-connect-btn").addEventListener("click", openAiModal);

function appendChatMsg(kind, text) {
  const log = document.getElementById("assistant-log");
  const div = document.createElement("div");
  div.className = `assistant-msg assistant-msg-${kind}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function speak(text) {
  if (!text || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// ---------- board context for the system prompt ----------
function buildBoardContext() {
  const lines = [];
  const leadSlugs = [...new Set(currentTasks.map((t) => t.lead).filter(Boolean))];
  leadSlugs.forEach((slug) => {
    const info = LEAD_INFO[slug] || { name: slug };
    const tasksForLead = currentTasks.filter((t) => t.lead === slug);
    const parts = tasksForLead.map((t) => `${t.id} [${t.type}, status=${t.status}]`);
    lines.push(`- ${info.name} (lead slug: ${slug}): ${parts.join("; ")}`);
  });
  const origin = currentTasks.filter((t) => !t.lead);
  origin.forEach((t) => {
    lines.push(`- Origin task ${t.id} "${t.title}" [${t.type}, status=${t.status}]`);
  });
  return lines.join("\n");
}

function buildSystemPrompt() {
  return [
    "You are Sideline, the voice/chat assistant for a small AI-agent business that finds no-website local businesses and pitches them a free demo site.",
    "Answer questions about the board using ONLY the data below — never invent task IDs, statuses, or business facts.",
    "Keep replies short and spoken-friendly (1-3 sentences) — they may be read aloud.",
    "If the user clearly asks to approve a specific task or lead, call the approve_task tool with the exact task_id from the data below. If they name a lead with multiple pending tasks, call approve_task once per pending task_id for that lead.",
    "Never call approve_task speculatively or for a lead/task that isn't clearly pending. If unsure which task they mean, ask a short clarifying question instead of guessing.",
    "",
    "Current board state:",
    buildBoardContext(),
  ].join("\n");
}

const APPROVE_TOOL = {
  type: "function",
  function: {
    name: "approve_task",
    description: "Propose approving one pending task on the Sideline board by its exact task ID. This does NOT write anything by itself — the human is always shown a confirmation dialog first.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The exact task ID to approve, e.g. task_2026_0801_9lszyx" },
      },
      required: ["task_id"],
    },
  },
};

async function callOpenRouter(messages) {
  const key = getAiKey();
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": location.href,
      "X-Title": "Sideline",
    },
    body: JSON.stringify({
      model: getAiModel(),
      messages,
      tools: [APPROVE_TOOL],
    }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("ai-key-invalid");
    if (res.status === 429) throw new Error("ai-rate-limited");
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `OpenRouter request failed: ${res.status}`);
  }
  return res.json();
}

async function sendToAssistant(userText) {
  if (!userText || !userText.trim()) return;
  if (!getAiKey()) {
    pendingAiSend = userText;
    openAiModal();
    return;
  }
  appendChatMsg("user", userText);
  aiMessages.push({ role: "user", content: userText });

  const systemMsg = { role: "system", content: buildSystemPrompt() };
  try {
    let data = await callOpenRouter([systemMsg, ...aiMessages]);
    let msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Empty response from model");

    if (msg.tool_calls && msg.tool_calls.length) {
      aiMessages.push(msg);
      for (const call of msg.tool_calls) {
        if (call.function?.name !== "approve_task") continue;
        let args = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* leave empty */ }
        const taskId = args.task_id;
        appendChatMsg("system", `Assistant proposes approving ${taskId || "(missing task id)"} — check the confirmation dialog.`);
        const outcome = taskId ? await approveTaskRemote(taskId) : "error: model did not provide a task_id";
        aiMessages.push({ role: "tool", tool_call_id: call.id, content: outcome });
      }
      data = await callOpenRouter([systemMsg, ...aiMessages]);
      msg = data.choices?.[0]?.message;
    }

    aiMessages.push(msg);
    const replyText = msg?.content || "(no reply)";
    appendChatMsg("bot", replyText);
    speak(replyText);
  } catch (err) {
    if (err.message === "ai-key-invalid") {
      appendChatMsg("system", "Assistant key was rejected by OpenRouter. Reconnect with a valid key.");
      clearAiKey();
      updateAiConnectButton();
    } else if (err.message === "ai-rate-limited") {
      appendChatMsg("system", "Free-tier rate limit hit on OpenRouter — wait a moment and try again.");
    } else {
      appendChatMsg("system", "Assistant error: " + err.message);
    }
  }
}

document.getElementById("assistant-send").addEventListener("click", () => {
  const input = document.getElementById("assistant-text");
  const text = input.value;
  input.value = "";
  sendToAssistant(text);
});
document.getElementById("assistant-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("assistant-send").click();
  }
});

// ---------- voice input (mic feeds the same assistant pipeline) ----------
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = document.getElementById("assistant-mic");
if (!SpeechRecognitionImpl) {
  micBtn.disabled = true;
  micBtn.title = "Speech recognition isn't supported in this browser.";
} else {
  micBtn.addEventListener("click", () => {
    const recog = new SpeechRecognitionImpl();
    recog.lang = "en-US";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    micBtn.classList.add("assistant-mic-active");
    recog.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      sendToAssistant(transcript);
    };
    recog.onerror = (e) => appendChatMsg("system", "Voice recognition error: " + e.error);
    recog.onend = () => micBtn.classList.remove("assistant-mic-active");
    recog.start();
  });
}

// ---------- lightweight context load (no board rendering on this page) ----------
async function loadContext() {
  try {
    currentTasks = await fetchTasksLive();
  } catch (err) {
    appendChatMsg("system", "Couldn't load the live board for context: " + err.message);
  }
}

// ---------- init ----------
initGithubConnectUi();
updateAiConnectButton();
loadContext();
setInterval(loadContext, 60000);
