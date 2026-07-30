# SIDELINE — The Student-Athlete Agent Studio

**An operations blueprint for a one-person, AI-powered local business services company.**
**Owner-operator:** one student athlete. **Staff:** a small fleet of AI agents working asynchronously, in parallel, in the cloud — supervised from a single beautiful dashboard.

> This document is written to be read by two audiences at once: **you** (the human founder), and **your agents** (each agent should be given this file, plus its own role card from `/agents/`, as its standing instructions). Every section marked `AGENT-READABLE` is written as a direct instruction set an agent can follow without you in the room.

---

## Table of Contents

1. [The Business in One Paragraph](#1-the-business-in-one-paragraph)
2. [Architecture Overview](#2-architecture-overview)
3. [The Agent Roster & Role Cards](#3-the-agent-roster--role-cards) `AGENT-READABLE`
4. [Task Protocol: How Work Flows](#4-task-protocol-how-work-flows) `AGENT-READABLE`
5. [Async & Parallel Execution Rules](#5-async--parallel-execution-rules) `AGENT-READABLE`
6. [Cloud Deployment Plan](#6-cloud-deployment-plan)
7. [Protocols: MCP, A2A, and UCP](#7-protocols-mcp-a2a-and-ucp)
8. [The Monitoring UI — "Mission Control" Blueprint](#8-the-monitoring-ui--mission-control-blueprint)
9. [Scaling Path](#9-scaling-path)
10. [Guardrails, Safety & The Human Veto](#10-guardrails-safety--the-human-veto) `AGENT-READABLE`
11. [Phase Plan: Crawl → Walk → Run](#11-phase-plan-crawl--walk--run)

---

## 1. The Business in One Paragraph

**Sideline** finds local businesses that have no website (or barely any online presence), builds each one a real working demo site on spec, then has an AI voice agent **call the business**, introduce itself honestly as an AI assistant calling on behalf of Sideline, and pitch the free demo along with an offer to build them a full site. The moment a business says yes, the founder gets a **push notification on their phone** with the outcome and a link to the call transcript and the demo site — and picks up the relationship personally from there. Agents prospect, build, and dial; the human closes, prices, and delivers. Nothing is promised, priced, or committed to a business without the founder in the loop.

**The economic engine:** every hour of founder time should turn into many hours of agent-driven prospecting, building, and dialing — so that the founder's real job becomes reviewing transcripts and closing warm leads between practices, not cold-calling from scratch.

---

## 2. Architecture Overview

```
                        ┌──────────────────────────────┐
                        │        MISSION CONTROL        │
                        │   (Monitoring UI — see §8)    │
                        └──────────────┬───────────────┘
                                       │ reads/writes
                        ┌──────────────▼───────────────┐
                        │        TASK BOARD (DB)        │
                        │  tasks.json / Postgres table  │
                        │  single source of truth       │
                        └──┬──────┬──────┬──────┬──────┘
              claims task  │      │      │      │     claims task
        ┌──────────────┐ ┌▼────┐┌▼─────┐┌▼─────┐┌▼──────────┐
        │ ORCHESTRATOR │ │SCOUT││SCRIBE││BUILDER││ CALLER    │ ...
        │ (dispatcher) │ │(leads)│(script)│(demo site)│(voice call)│
        └──────┬───────┘ └─┬───┘└─┬────┘└─┬────┘└─┬─────────┘
               │  A2A messages │     │       │       │
               └───────┬───────┴──┬──┴───┬───┴───┬───┘
                       │          │       │       │
                ┌──────▼─────┐┌───▼─────┐┌▼──────┐┌▼────────────┐
                │ MCP SERVERS││ARTIFACT ││ VOICE  ││  NOTIFIER    │
                │ (places API,││ STORE  ││GATEWAY ││ (SMS/push to │
                │ files, web) ││(sites, ││(Twilio+││ founder's    │
                │             ││transcripts)│STT/TTS)││ phone)      │
                └────────────┘└─────────┘└────────┘└──────────────┘
```

**Core ideas:**

- **One shared Task Board** is the single source of truth. Agents never make promises to businesses and never hold private state that matters — if it isn't on the board or in the artifact store, it didn't happen.
- **Agents are stateless workers.** Each wakes up (on a schedule or a trigger), claims a task, does it, writes results, and goes quiet. This is what makes the system parallel, resilient, and cheap.
- **The Orchestrator** is itself an agent whose only job is decomposing the pipeline (find leads → build demo → write script → call → notify founder) into small tasks and placing them on the board with dependencies.
- **The Voice Gateway** is a new, isolated layer: it's the only thing that ever dials a real phone number, and it only acts on `call_pitch` tasks that have already passed the do-not-call check (§10.6).
- **The Notifier** is the direct line to the founder's phone — it fires the moment a business says yes, independent of whether the founder happens to have Mission Control open.
- **The human sits above everything** with Mission Control, the approval queue, and the only authority to price, promise, or close a deal.

---

## 3. The Agent Roster & Role Cards

`AGENT-READABLE` — *If you are an agent, find your name below. Your role card defines what you may do, what you must never do, and what "done" means for you.*

Each agent gets a file in `/agents/<name>.md` containing exactly this structure. The six launch agents:

### 3.1 ORCHESTRATOR — the dispatcher

- **Mission:** Convert the founder's target list (towns, business categories, daily call volume) into small, well-specified tasks on the Task Board, in the order prospect → demo → script → call → notify.
- **Inputs:** Founder instructions; target market config (`/config/markets.json`); the do-not-call list (`/config/dnc.json`).
- **Outputs:** Task records (schema in §4) with clear acceptance criteria and dependency links.
- **May:** Create, split, reprioritize, and cancel tasks; message other agents via A2A to clarify capacity.
- **Must never:** Execute prospecting, building, writing, or calling work itself; mark any task `approved`; create a `call_pitch` task for any number on the DNC list; contact any external party directly.
- **Done means:** Every active market has a full pipeline of tasks for the next 7 days, none blocked without a stated reason, and zero `call_pitch` tasks exist for blocklisted numbers.

### 3.2 SCOUT — lead finding

- **Mission:** Find real local businesses with no website or a dead/unclaimed one, in the founder's target categories and towns.
- **Inputs:** Tasks of type `prospect`; market config (category + geography).
- **Outputs:** A lead record per business (`/artifacts/<task_id>/lead.json`) — name, phone, address, category, hours, photos, and the specific evidence it has no site (empty website field, 404, Facebook-page-only, etc.), all sourced from a legitimate public listing (Google Places API, Yelp Fusion API, or a public directory).
- **May:** Use the places/business-listing MCP tool; read a business's own public pages.
- **Must never:** Log in to any account; scrape anything behind a login; pull phone numbers from anywhere but a business's own public listing; add a lead whose number appears in `/config/dnc.json`.
- **Done means:** Lead record is complete, every field sourced, and the business is confirmed to have no working website.

### 3.3 SCRIBE — script & copy

- **Mission:** Write the call script (the CALLER's talk track), SMS/notification copy, and the demo site's on-page copy, all in Sideline's voice — direct, warm, no hard sell.
- **Inputs:** Tasks of type `write_script` or `write_site_copy` + the SCOUT lead record.
- **Outputs:** `/artifacts/<task_id>/script.md` (opening disclosure line, hook, offer, objection handles, close-the-loop line) or `/artifacts/<task_id>/site_copy.md`.
- **May:** Request a follow-up lead detail from SCOUT via A2A if the record is missing something the script needs (max one round trip).
- **Must never:** Invent facts about the business; write a script that omits or buries the "I'm an AI assistant" disclosure (§10.6); write anything that quotes a firm price or promises a delivery date — those are the founder's to give.
- **Done means:** Script opens with the mandatory disclosure line verbatim, fits the call-length budget, and passes the self-checklist embedded in its role card.

### 3.4 BUILDER — demo site construction

- **Mission:** Build a real, live, one-page demo website for each qualifying lead — name, hours, address, photos, a contact method — good enough to be the actual pitch ("we already built you this").
- **Inputs:** Tasks of type `build_demo_site` + the SCOUT lead record + SCRIBE's site copy.
- **Outputs:** A deployed demo site + `/artifacts/<task_id>/demo/` containing the source, a screenshot, and the live URL.
- **May:** Use a templated site generator; use client photos already public on their own listing.
- **Must never:** Use a business's logo or photos from anywhere but their own public listing; imply the site is already fully live/production ("paid for") rather than a demo; publish the demo anywhere but its own preview URL.
- **Done means:** The demo loads, matches the business's real info exactly, and the live URL is in the task's `artifacts` array before the task can be claimed for `write_script`/`call_pitch`.

### 3.5 CALLER — voice outreach

- **Mission:** Call the business, deliver SCRIBE's script through a natural voice, gauge interest in the free demo + a real site, and log the outcome. This is the only agent that touches the phone network.
- **Inputs:** Tasks of type `call_pitch` (depends on `build_demo_site` + `write_script` both being `approved`... see note below).
- **Outputs:** `/artifacts/<task_id>/call/` containing the transcript, the disposition, and (only where legally permitted per §10.6) the recording.
- **May:** Use the voice-gateway MCP tool only; dial only numbers that have passed the DNC check; ask if now's a bad time and offer to call back.
- **Must never:** Skip or shorten the opening AI-disclosure line; deny being an AI if asked; quote a price, promise a delivery date, or take any payment or contract detail; call outside the permitted calling window (§10.6); call a number more than once without a fresh callback request; call a number already in `/config/dnc.json`.
- **Done means:** Call is logged with a clear disposition (`interested` / `not_interested` / `voicemail` / `callback_requested` / `do_not_call` / `no_answer`), and any `interested` or `callback_requested` outcome has triggered a Notifier task before the task is marked `review_ready`.

> **Note on human review before dialing:** unlike content tasks, a `call_pitch` task is *time-sensitive* — waiting for a founder to `approve` every single call before it goes out would defeat the point of automation. The founder instead approves the **script and demo site template per category** once (e.g., "yes, call every no-website pizzeria in this town with this script"), and CALLER dials autonomously within that pre-approved lane. Anything outside the lane (new category, new town, script edit) requires a fresh human approval. See §10.1.

### 3.6 LEDGER — reporting & ops

- **Mission:** Compile weekly internal status: leads found, demos built, calls made, dispositions, and cost per stage; track the full funnel from `prospect` to closed client.
- **Inputs:** Tasks of type `report`; task history across the board.
- **Outputs:** `/artifacts/<task_id>/report.md` + a metrics JSON that Mission Control renders.
- **Must never:** Estimate or fabricate metrics that aren't in task history; access payment systems.
- **Done means:** Every number in the report traces to a task record or artifact file.

> **Adding an agent later** (e.g., CLOSER for automated follow-up emails after a "yes") = write one new role card + register its name in `config/agents.json`. Nothing else changes. That's the scalability contract.

---

## 4. Task Protocol: How Work Flows

`AGENT-READABLE` — *This is the law of the Task Board. All agents follow it exactly.*

### 4.1 The Task Schema

Every task is a JSON record. This exact schema — nothing ad hoc:

```json
{
  "id": "task_2026_0731_0042",
  "lead": "rosas-pizza-springfield",
  "type": "call_pitch",
  "title": "Cold call — Rosa's Pizza (no website found)",
  "spec": "Call using script task_2026_0731_0040 and demo site task_2026_0731_0041. Disclose AI up front. Offer the free demo, gauge interest, do not quote price.",
  "acceptance_criteria": [
    "Opening disclosure line delivered verbatim",
    "Disposition logged: interested | not_interested | voicemail | callback_requested | do_not_call | no_answer",
    "If interested or callback_requested: Notifier task created before review_ready"
  ],
  "depends_on": ["task_2026_0731_0040", "task_2026_0731_0041"],
  "assigned_role": "CALLER",
  "status": "queued",
  "priority": 2,
  "claimed_by": null,
  "claimed_at": null,
  "deadline": "2026-08-01T18:00:00-07:00",
  "artifacts": [],
  "call_outcome": {
    "disposition": null,
    "transcript_url": null,
    "recording_url": null,
    "duration_seconds": null,
    "recorded_with_consent": null
  },
  "history": [
    {"at": "2026-07-31T09:00:00-07:00", "event": "created", "by": "ORCHESTRATOR"}
  ],
  "human_approval": {"required": true, "status": "pending", "notes": "pre-approved: 'no-website pizzeria' lane, script v3, town=Springfield"}
}
```

### 4.2 The Status Lifecycle

```
queued → claimed → in_progress → review_ready → approved → delivered
                        │              │
                        ▼              ▼
                     blocked        changes_requested → in_progress
                        │
                        ▼
                     failed (after 2 retries) → escalated_to_human
```

**Rules:**

1. **Claim atomically.** An agent claims a task by writing `claimed_by` + `claimed_at` in one operation. If the field is already set, back off — never work a task another agent holds.
2. **Heartbeat.** While working, update `history` at least every 10 minutes. A claimed task with no heartbeat for 30 minutes is considered abandoned; the Orchestrator resets it to `queued`.
3. **Dependencies gate claims.** Never claim a task whose `depends_on` list contains anything not yet `approved` — a `call_pitch` task can never be claimed before its demo site and script exist.
4. **All output is artifacts.** Write files to `/artifacts/<task_id>/`, list them in the task's `artifacts` array, then set status `review_ready`. Never paste deliverables only into chat/logs.
5. **Two-retry rule.** If you fail, log why in `history`, retry with an adjusted approach at most twice, then set `failed` with a plain-English explanation a busy human can read in 10 seconds.
6. **Nothing skips the human.** `approved` and `delivered` can only be set from Mission Control by the founder. No agent may ever set these statuses, including the Orchestrator. **Pre-approval is scoped**, not blanket: a founder approving "call this lane with this script" never implies approval to price, promise, or contract — that's still a human-only act, every time.

### 4.3 Recurring Work

The Orchestrator maintains `config/markets.json` (e.g., `{"town": "Springfield", "categories": ["pizzeria","barbershop","landscaper"], "daily_call_cap": 15}`) and refills the prospect → demo → script → call pipeline nightly so the founder wakes up to a fresh queue of leads and a fresh batch of overnight call outcomes.

---

## 5. Async & Parallel Execution Rules

`AGENT-READABLE`

The system is parallel **by lead** and **by stage**, and asynchronous **by design**:

- **Parallel by lead:** SCOUT can be finding new pizzerias in Springfield while BUILDER finishes a demo for a barbershop and CALLER dials a landscaper. No cross-lead dependencies exist, ever.
- **Parallel by stage:** Within one lead, the pipeline is strictly ordered (prospect → build → script → call), but different leads sit at different stages simultaneously; the `depends_on` graph is the only synchronization mechanism.
- **Async by trigger:** Agents run on schedules (cron) or events (a task entering `queued` for their role). No agent waits idly on another agent's completion — it finishes its claim and exits.
- **Idempotency:** Every agent action must be safe to run twice. Before dialing, BUILDER building, or SCOUT adding a lead, check whether it already exists for this lead/task_id — **never call the same business twice for the same offer.**
- **Budget ceilings:** Each run has a hard cap (default: 15 tool calls or 5 minutes, whichever first). Hitting the cap → save partial work, log state, set `blocked` with a resume note. CALLER additionally respects `daily_call_cap` from `config/markets.json` — hitting it ends the day's dialing, not just the run.
- **No side channels:** Coordination happens only through the Task Board and A2A messages that are logged to the board's `history`. An unlogged decision — including an unlogged call — is a bug.

---

## 6. Cloud Deployment Plan

The whole point of cloud execution: agents prospect, build, and dial while you're at practice — and your phone buzzes the moment one says yes.

**Recommended starter stack — open source preferred wherever a real option exists:**

| Layer | Tool | Why |
|---|---|---|
| Code + role cards | **Git + a self-hosted or GitHub repo** (this README lives at its root) | Free, versioned; GitHub Actions gives you a free scheduler, or self-host with **Gitea** if you want the whole chain open |
| Agent runtime | **GitHub Actions** (crawl phase) → a self-hosted worker on your own VM (walk phase), orchestrated with **n8n** (open source) or a plain cron + script if you want zero extra moving parts | Cron-triggered scripts calling an LLM are the simplest possible "cloud agent"; n8n is optional glue, not a requirement |
| Agent brains | **Claude API** for reasoning/drafting (not open source, but this is the one layer where "open weights" trades real quality for openness — an open-weight model via **Ollama**/**vLLM** is a legitimate self-hosted alternative once you want to cut this cost, especially for the cheaper SCOUT/LEDGER runs) | Model-per-role keeps cost low; role cards become system prompts either way |
| Business/lead data | **OpenStreetMap Overpass API** (free, open data) as the primary source, cross-checked against **Google Places API** where OSM's phone/hours data is stale or missing | OSM is genuinely open but coverage and freshness for small local businesses is patchy — budget for the Places API as a fallback, not a nice-to-have |
| Voice pipeline | **Pipecat** or **Vocode** (both open source, self-hosted real-time voice-agent frameworks: STT → LLM → TTS over a call) + **Whisper**/**faster-whisper** (open source STT) + **Piper** or **Coqui TTS** (open source TTS) | Fully self-hostable, no per-minute platform markup on top of raw compute — the honest tradeoff is open-source TTS is noticeably less "human" than a proprietary voice like ElevenLabs, so test it against a real call before committing |
| Telephony (PSTN access) | **Twilio** | The one layer that's genuinely hard to open-source: originating real phone calls requires either a commercial SIP/PSTN provider like Twilio, or self-hosting **Asterisk**/**FreeSWITCH** with your own SIP trunk — open source software, but not an open network. Twilio is the pragmatic starting choice; revisit self-hosted SIP once call volume justifies the ops overhead |
| Founder notification | **ntfy** (open source, self-hostable push notifications) as the default; Twilio SMS as a fallback if you want it to land as a text rather than an app push | ntfy gets you a real-time phone alert with no per-message fee and no proprietary dependency |
| Task Board | Start: `tasks/` folder of JSON in the repo. Scale: **Supabase** (Postgres + realtime + auth — open source, self-hostable, or use their free hosted tier) | Same schema either way; realtime subscriptions later power live dashboard updates |
| Artifact store | Repo `/artifacts/` (transcripts, demo site source) → **Supabase Storage** (open source) or a self-hosted **MinIO** bucket when files get big | Everything reviewable from your phone |
| Demo site hosting | Static files served by **Caddy** on your own VM, or **Vercel/Netlify free tier** if you'd rather not run a server yet | Cheap enough to build-and-abandon dozens of unused demos either way |
| Mission Control UI | **React** (open source), self-hosted alongside the demo sites or on Vercel/Netlify's free tier | See §8 |
| Secrets | `.env` + your platform's secret store (GitHub Actions secrets, or a self-hosted **Vaultwarden**/`.env` on your VM) | API keys, Twilio credentials, and phone numbers never live in code |

**Deployment shape, in words:** each agent is a small script (Python or Node). A scheduler wakes it, it reads the Task Board, claims one task, builds a prompt from *role card + task spec + input artifacts*, calls the model with its allowed MCP tools, writes artifacts, updates the task, and exits. CALLER is the exception: its "run" is a live phone call, orchestrated by the Pipecat/Vocode pipeline, that ends with the same claim → artifacts → status-update pattern as everyone else.

**A cost note, honestly:** hosting is genuinely close to free, and the open-source-first stack above cuts the platform markup that Vapi/Bland/Retell-style products charge on top of raw voice compute. It doesn't cut PSTN costs — Twilio's per-minute call rate is still real money, typically a few cents/minute, on top of whatever compute runs Whisper/Piper/the LLM turn. At even 15 calls/day averaging 90 seconds, that's recurring spend worth tracking, not a rounding error. Budget for calling separately from hosting, and track $/call in LEDGER's report from day one.

---

## 7. Protocols: MCP, A2A, and UCP

Three open protocols, three distinct jobs. Honest guidance included, because you asked me to be your best advisor, not just your hype man.

### 7.1 MCP — Model Context Protocol *(agents ↔ tools)* — **use from day one**

MCP is how each agent gets hands. Run or connect MCP servers for: **filesystem** (artifact store), **places/business-listing lookup** (SCOUT), **the voice gateway** (CALLER's only door to the phone network), and **notifications** (SMS/push to the founder). In each agent's config, grant only the servers its role card permits — SCRIBE gets files, not the phone; only CALLER ever gets the voice-gateway tool. Least privilege is written into the role cards on purpose, and for CALLER it's not just hygiene — it's the only thing standing between "an agent drafted a bad line" and "an agent said a bad line to a real business owner on a recorded line."

### 7.2 A2A — Agent2Agent *(agents ↔ agents)* — **optional; don't adopt just because it's a standard**

A2A is an open standard for agents discovering each other's capabilities and exchanging tasks/messages directly. In Sideline it would power the narrow lane where agents talk peer-to-peer: SCRIBE requesting a missing lead detail from SCOUT. At six agents you fully control, on one task board, you don't need the real protocol — faking it with a logged message on the task's `history` gets identical behavior with zero infrastructure. Adopt real A2A when you have agents you *don't* control talking to yours (a client's own agent, a contractor's agent) — not on a fixed phase timeline.

### 7.3 UCP — Universal Commerce Protocol *(agents ↔ commerce)* — **roadmap footnote, not architecture**

UCP is an emerging standard for agentic commerce — agents discovering a business's checkout/subscribe capability and transacting with it. It's early, and it has nothing to do with the calling pipeline. Where it might eventually fit Sideline: once you're selling ongoing site-hosting subscriptions, a UCP capability profile could let other people's AI assistants discover and subscribe to that offering. That's a month-6+ idea. Note it in `docs/roadmap.md`, revisit quarterly, and don't let it influence anything you build in the next 90 days. **Any commerce/payment integration is permanently behind the human veto: no agent ever initiates, quotes, or accepts a transaction autonomously — CALLER included.**

---

## 8. The Monitoring UI — "Mission Control" Blueprint

A single-page React app. Design language: dark, calm, athletic — think *scoreboard at night*, not enterprise dashboard.

### 8.1 Visual system

- **Palette:** near-black background (`#0B0E14`), soft slate panels (`#151A24`), one electric accent for live activity (`#4ADE80` green pulse), amber for `review_ready`, red reserved exclusively for `failed/escalated` and `do_not_call`. Lead categories appear as small color chips, never full theming.
- **Type:** a strong condensed display face for numbers (score-board energy), a quiet humanist sans for everything else. Big numerals, generous whitespace, no chrome.
- **Motion:** everything breathes but nothing bounces — 200ms fades, a slow 2s pulse on active agents, and on CALLER specifically, a live waveform while a call is in progress. Motion means *live*, stillness means *idle*.

### 8.2 Layout — four zones

```
┌─────────────────────────────────────────────────────────────┐
│  TOP BAR   Sideline ▸ Mission Control     ⏸ Pause All  ● Live│
├──────────────┬──────────────────────────────────────────────┤
│  ZONE A      │   ZONE B — THE FIELD                          │
│  AGENT ROSTER│   Kanban river: Queued → Working → Review →   │
│              │   Approved → Delivered. Cards flow left→right.│
│  ● ORCHESTR. │   Each card: lead chip, title, agent avatar,  │
│  ● SCOUT     │   age, deadline ring. CALLER cards show a live│
│  ◐ BUILDER ⚡│   waveform while a call is in progress.       │
│  ○ SCRIBE    ├──────────────────────────────────────────────┤
│  ○ CALLER    │   ZONE C — APPROVAL QUEUE (the money row)     │
│  ○ LEDGER    │   Two lanes: (1) content/demo approvals, and  │
│              │   (2) call outcomes needing you — every       │
│  each: status│   "interested"/"callback_requested" lead,     │
│  ring, tasks │   with transcript + audio player + one-tap    │
│  today, cost │   "call them back now". Designed for          │
│  today, last │   thumb-speed review on a phone.              │
│  heartbeat   ├──────────────────────────────────────────────┤
│              │   ZONE D — PULSE                              │
│              │   Live event ticker + 3 sparkline stats:      │
│              │   calls/day, $/call, lead→interested rate.    │
└──────────────┴──────────────────────────────────────────────┘
```

**Zone A — Agent Roster.** One card per agent: a status ring (green pulsing = working, amber = blocked, gray = idle, red = failed run), tasks completed today, spend today, and time since last heartbeat. Click → drawer with that agent's full run log and its role card.

**Zone B — The Field.** The Kanban river of all tasks, filterable by market/category. Cards animate as agents move them — you literally watch a lead move from prospected to demo-built to called.

**Zone C — Approval Queue.** The most important pixels in the product, now doing double duty: content/demo approvals as before, plus every call outcome that needs a human — transcript inline, audio playable, one-tap callback. Ten minutes on the bus clears a day of output *and* a day of warm leads.

**Zone D — Pulse.** A live ticker of A2A messages and task events, plus three sparklines centered on the funnel: calls/day, $/call, lead→interested conversion.

### 8.3 The out-of-band channel: your phone buzzes first

Mission Control is where you *review*; it is not where you first *hear*. The moment CALLER logs a disposition of `interested` or `callback_requested`, a Notifier task fires immediately — independent of whether Mission Control is open — and sends a single SMS/push: business name, disposition, one-line transcript summary, and a link straight into Zone C for that lead. This is the literal thing you asked for: *a message on your phone saying whether they accepted.* Everything else in Mission Control is for when you have ten spare minutes; this channel is for the moment it happens.

### 8.4 Data contract

The UI is a pure reader/writer of the Task Board plus one `events` stream — no business logic in the frontend. Crawl phase: poll `tasks/` JSON every 30s. Walk phase: Supabase realtime subscription, and the whole thing goes live-updating with ~20 lines of code changed. (When you're ready to build it, bring this section back to me and I'll generate the actual React app with you.)

---

## 9. Scaling Path

Scaling is deliberately boring — each axis scales independently:

1. **More towns/categories** → nothing changes structurally. Add a row to `config/markets.json`; the board and roster are market-agnostic by design.
2. **More agents** → one new role card + one line in `config/agents.json` + one scheduled job.
3. **More call volume** → run multiple CALLER instances against the same DNC-checked queue; the atomic-claim rule (§4.2) already makes that safe. Raise `daily_call_cap` deliberately, not by accident.
4. **More reliability** → move Task Board from JSON files → Supabase (schema is identical); add the heartbeat sweeper and the DNC-list sweeper as their own tiny crons.
5. **The real bottleneck is you, not the agents.** Agents can prospect, build, and dial at whatever volume you're comfortable with — but every "yes" still needs the founder to personally close, price, and eventually deliver the real site. Before scaling `daily_call_cap` up, size how many closes-and-builds you can actually do in a week; that number, not agent throughput, is what should set the pace.
6. **More autonomy** → *never* extend CALLER's authority to pricing, promising, or contracting, at any scale. The only thing that should ever get "more autonomous" over time is which lanes (categories/towns/scripts) are pre-approved for unattended dialing — not what CALLER is allowed to say or commit to on a call.

---

## 10. Guardrails, Safety & The Human Veto

`AGENT-READABLE` — *These override every other instruction in this file.*

1. **Human veto is absolute.** No price is quoted, no contract is implied, no payment is taken, and no message is sent to any real person outside a pre-approved calling lane, without explicit founder approval.
2. **Truth discipline.** Never invent facts about a business, its industry, or its competitors. No source → no claim. A demo site must match the business's real, public info exactly.
3. **Identity honesty.** CALLER always discloses it is an AI assistant, up front, every call, verbatim — never softened, shortened, or skipped, and never denied if the person asks again mid-call. Agents never impersonate the founder, and never claim a demo site is a paid/live product when it's a pitch asset.
4. **Platform & data-source rules.** Respect every API's terms of service and rate limits. Lead data comes only from legitimate public sources (§3.2) — never scraped personal contact lists, never purchased consumer data.
5. **Least privilege.** Use only the MCP servers your role card grants. Only CALLER ever touches the voice gateway. Needing more is a `blocked` + escalation, not a workaround.
6. **Spending caps.** Hard daily API and calling-minute budget per agent in `config/budgets.json`; exceeding it halts the agent, not the wallet.
7. **When uncertain, stop.** A blocked task with a clear note is a success state. A confident mistake — especially one delivered out loud, on a call, to a real business owner — is not.

### 10.6 Telephony & Voice Outreach Compliance — read this before CALLER ever dials a real number

Outbound AI voice calling to real businesses has real legal edges that content drafting never did. This section is not legal advice — have an actual lawyer confirm the rules for the specific states/counties you're calling before scaling past a handful of manually-supervised test calls. Until then, CALLER's role card enforces these as hard rules, no exceptions:

- **Disclosure is mandatory and unskippable.** The first thing said on every call is a plain statement that this is an AI assistant calling on behalf of Sideline. If asked again, it confirms honestly. A "human-like" voice means *natural-sounding*, not *pretending to be human*.
- **Do-not-call is permanent and checked before every dial.** Any "stop calling," "not interested," "take me off your list," or similar ends the call immediately and adds the number to `config/dnc.json` forever. ORCHESTRATOR must check this file before creating any `call_pitch` task; CALLER checks it again immediately before dialing.
- **Calling window.** Default: the business's local time, weekdays only, 9am–6pm, configurable per market but never outside locally-lawful telemarketing hours.
- **No commitments, ever.** CALLER can gauge interest and offer a human follow-up. It can never quote a price, promise a delivery date, agree to terms, or take any payment or contract detail. Every `interested` outcome routes to the founder — no exceptions, no matter how enthusiastic the business sounds.
- **Recording requires real consent, not assumed consent.** Many states require all-party consent to record a call. Default to **not recording** (keep the transcript only) until you've confirmed the rule for that state and, where required, built a spoken consent line into the script's opening. `call_outcome.recorded_with_consent` must be explicitly true before a recording artifact is stored.
- **One call per lead per offer.** Never re-dial a number that's already been called for the same offer, whether it said yes, no, or nothing.
- **Data sourcing stays legitimate.** Phone numbers come only from a business's own public listing (§3.2/§10.4) — never scraped, never purchased.

---

## 11. Phase Plan: Crawl → Walk → Run

**Crawl (weeks 1–3): prove the offer converts before automating the calling.**
Repo + this README + role cards. SCOUT's job is done by hand or Claude-assisted: pull ~30 local no-website businesses in one town via a quick Google Maps pass. BUILDER hand-builds (Claude-assisted) 3–5 real demo one-pagers for the strongest leads. SCRIBE drafts one tight call script. **The founder makes the actual calls personally** — no voice AI yet — because before a dollar is spent on telephony infrastructure, you want proof the demo-site-plus-call offer actually converts. LEDGER tracks call → interested → closed by hand in a spreadsheet. *Revenue starts here, and so does the evidence that automating the call is worth building.*

**Walk (weeks 4–8): automate prospecting and building; bring CALLER online carefully.**
Automate SCOUT via the Places/Yelp API for a daily lead list. Automate BUILDER to template-generate a demo site per lead. Stand up CALLER on a voice-AI platform in a supervised mode first — live-listen or reviewed-before-scaling — with the full §10.6 guardrails wired in from the first real call, not added later. Wire the Notifier (§8.3) so every "yes" or callback request pings your phone in real time. Build the call-outcome lane into Mission Control's Zone C. Goal: CALLER dials pre-approved lanes unattended, and you get a phone ping only when it matters.

**Run (month 3+): scale markets, not risk.**
Multiple CALLER instances across more towns/categories, within whatever `daily_call_cap` matches your actual close-and-build capacity (§9.5) — not agent throughput. LEDGER tracks the full funnel per market. Revisit UCP (§7.3) once you're selling ongoing hosting subscriptions, for checkout discovery — never for the calling itself.

---

## 12. This Repo Right Now

This repo is at the very start of **Crawl**. What exists today:

- `/agents/*.md` — the six role cards from §3, verbatim.
- `/config/*.json` — starter config for markets, budgets, the do-not-call list, and the agent registry.
- `/tasks/tasks.json` — the task board itself (a flat JSON array for now, per §4.1/§6; migrates to Supabase later with the same schema).
- `/src/` — a small TypeScript CLI (`sideline task ...`, `sideline dnc ...`) that implements the task lifecycle rules from §4.2: atomic claiming, dependency gating, and human-only `approve`/`deliver`.
- `/artifacts/` — empty, waiting for the first lead/demo/script/call artifacts.

Not built yet, on purpose (see §11): SCOUT/BUILDER/SCRIBE/CALLER/LEDGER as actual running agents, the voice pipeline, the notifier, and Mission Control. Each is its own next increment.

### Licensing — the split that matters

The Sideline system itself (this repo — role cards, task board, orchestration, CLI, scripts, prompts) is **proprietary**; see `/LICENSE`. That's the business.

What's genuinely open is the **output**: every demo site BUILDER produces for a lead ships with its own MIT license (`/templates/demo-site-license.mit.txt`, stamped with the business's name), so the business owns that code outright — free and clear, whether or not they ever sign up. Open-sourcing the product you hand a prospect builds trust and costs nothing; open-sourcing the machinery that finds and calls them would hand a competitor the business.

---

*Built by a student athlete. Operated between practices. Reviewed by a human, always.*
