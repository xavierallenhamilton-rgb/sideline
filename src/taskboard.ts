import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { customAlphabet } from "nanoid";
import { Task, TaskCreateInput, AgentSettableStatus, type TaskStatus } from "./schema.js";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../");
const TASKS_FILE = path.join(ROOT, "tasks", "tasks.json");
const DNC_FILE = path.join(ROOT, "config", "dnc.json");

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

export class TaskBoardError extends Error {}

// ---- Task Board persistence ----

function loadTasks(): Task[] {
  const raw = JSON.parse(readFileSync(TASKS_FILE, "utf-8"));
  return z.array(Task).parse(raw);
}

function saveTasks(tasks: Task[]): void {
  writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2) + "\n", "utf-8");
}

function nowIso(): string {
  return new Date().toISOString();
}

function dateStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}_${m}${day}`;
}

function pushHistory(task: Task, event: string, by: string, note?: string): void {
  task.history.push({ at: nowIso(), event, by, ...(note ? { note } : {}) });
}

// ---- Do-Not-Call list ----

interface DncEntry {
  phone: string;
  reason: string;
  added_at: string;
}

function loadDnc(): DncEntry[] {
  if (!existsSync(DNC_FILE)) return [];
  const raw = JSON.parse(readFileSync(DNC_FILE, "utf-8"));
  return (raw.numbers ?? []) as DncEntry[];
}

function saveDnc(numbers: DncEntry[]): void {
  writeFileSync(DNC_FILE, JSON.stringify({ numbers }, null, 2) + "\n", "utf-8");
}

export function dncCheck(phone: string): DncEntry | null {
  return loadDnc().find((e) => e.phone === phone) ?? null;
}

export function dncAdd(phone: string, reason: string): DncEntry {
  const entries = loadDnc();
  const existing = entries.find((e) => e.phone === phone);
  if (existing) return existing;
  const entry: DncEntry = { phone, reason, added_at: nowIso() };
  entries.push(entry);
  saveDnc(entries);
  return entry;
}

export function dncList(): DncEntry[] {
  return loadDnc();
}

// ---- Task operations ----

export function createTask(input: TaskCreateInput, createdBy: string): Task {
  if (input.type === "call_pitch" && input.lead_phone) {
    const blocked = dncCheck(input.lead_phone);
    if (blocked) {
      throw new TaskBoardError(
        `Refusing to create call_pitch task: ${input.lead_phone} is on the do-not-call list (reason: ${blocked.reason}, added ${blocked.added_at}). See README §10.6.`
      );
    }
  }

  const tasks = loadTasks();
  const id = `task_${dateStamp()}_${nanoid()}`;
  const task = Task.parse({
    id,
    lead: input.lead ?? null,
    lead_phone: input.lead_phone ?? null,
    type: input.type,
    title: input.title,
    spec: input.spec ?? "",
    acceptance_criteria: input.acceptance_criteria ?? [],
    depends_on: input.depends_on ?? [],
    assigned_role: input.assigned_role,
    priority: input.priority ?? 3,
    deadline: input.deadline ?? null,
    history: [],
  });
  pushHistory(task, "created", createdBy);
  tasks.push(task);
  saveTasks(tasks);
  return task;
}

export function listTasks(filter: { status?: TaskStatus; role?: string; lead?: string } = {}): Task[] {
  return loadTasks().filter(
    (t) =>
      (!filter.status || t.status === filter.status) &&
      (!filter.role || t.assigned_role === filter.role) &&
      (!filter.lead || t.lead === filter.lead)
  );
}

export function getTask(id: string): Task {
  const task = loadTasks().find((t) => t.id === id);
  if (!task) throw new TaskBoardError(`No such task: ${id}`);
  return task;
}

function withTask(id: string, mutate: (task: Task, tasks: Task[]) => void): Task {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new TaskBoardError(`No such task: ${id}`);
  mutate(task, tasks);
  saveTasks(tasks);
  return task;
}

// README §4.2 rule 1 (atomic claim) + rule 3 (dependencies gate claims) + §10.6 (DNC re-check)
export function claimTask(id: string, by: string): Task {
  return withTask(id, (task, tasks) => {
    if (task.claimed_by) {
      throw new TaskBoardError(
        `Task ${id} is already claimed by ${task.claimed_by} at ${task.claimed_at}. Back off — never work a task another agent holds.`
      );
    }
    const unmet = task.depends_on.filter((depId) => {
      const dep = tasks.find((t) => t.id === depId);
      return !dep || dep.status !== "approved";
    });
    if (unmet.length > 0) {
      throw new TaskBoardError(
        `Task ${id} has unapproved dependencies: ${unmet.join(", ")}. Never claim a task whose depends_on isn't fully approved (README §4.2 rule 3).`
      );
    }
    if (task.type === "call_pitch" && task.lead_phone) {
      const blocked = dncCheck(task.lead_phone);
      if (blocked) {
        task.status = "blocked";
        pushHistory(task, "blocked", by, `DNC re-check failed at claim time: ${blocked.reason}`);
        throw new TaskBoardError(
          `Refusing to claim call_pitch task ${id}: ${task.lead_phone} is on the do-not-call list. Task set to blocked.`
        );
      }
    }
    task.claimed_by = by;
    task.claimed_at = nowIso();
    task.status = "claimed";
    pushHistory(task, "claimed", by);
  });
}

// README §4.2 rule 2
export function heartbeat(id: string, by: string, note?: string): Task {
  return withTask(id, (task) => {
    if (task.status === "claimed") task.status = "in_progress";
    pushHistory(task, "heartbeat", by, note);
  });
}

// Any status an agent may legally set on its own (everything except approved/delivered).
export function setStatus(id: string, status: TaskStatus, by: string, note?: string): Task {
  const parsed = AgentSettableStatus.safeParse(status);
  if (!parsed.success) {
    throw new TaskBoardError(
      `${status} can only be set by the founder via 'sideline task approve'/'deliver' (README §4.2 rule 6), not by an agent.`
    );
  }
  return withTask(id, (task) => {
    task.status = status;
    pushHistory(task, `status:${status}`, by, note);
  });
}

export function addArtifact(id: string, artifactPath: string, by: string): Task {
  return withTask(id, (task) => {
    if (!task.artifacts.includes(artifactPath)) task.artifacts.push(artifactPath);
    pushHistory(task, "artifact_added", by, artifactPath);
  });
}

// README §4.2 rule 6 — human-only.
export function approveTask(id: string, by: string, note?: string): Task {
  return withTask(id, (task) => {
    task.status = "approved";
    task.human_approval.status = "approved";
    if (note) task.human_approval.notes = note;
    pushHistory(task, "approved", by, note);
  });
}

export function deliverTask(id: string, by: string, note?: string): Task {
  return withTask(id, (task) => {
    task.status = "delivered";
    pushHistory(task, "delivered", by, note);
  });
}

export function requestChanges(id: string, by: string, note: string): Task {
  return withTask(id, (task) => {
    task.status = "changes_requested";
    task.human_approval.status = "rejected";
    task.human_approval.notes = note;
    pushHistory(task, "changes_requested", by, note);
  });
}
