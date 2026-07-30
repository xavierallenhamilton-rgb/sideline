import { z } from "zod";

// Mirrors README.md §4.1 exactly. Keep this file and the README's example
// task JSON in sync if either changes.

export const TaskStatus = z.enum([
  "queued",
  "claimed",
  "in_progress",
  "review_ready",
  "approved",
  "delivered",
  "blocked",
  "changes_requested",
  "failed",
  "escalated_to_human",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

// Statuses an agent may set directly via `sideline task status`.
// approved/delivered are human-only (README §4.2 rule 6) and go through
// dedicated `sideline task approve` / `sideline task deliver` commands instead.
export const AgentSettableStatus = TaskStatus.exclude(["approved", "delivered"]);

export const TaskType = z.enum([
  "prospect",
  "build_demo_site",
  "write_script",
  "write_site_copy",
  "call_pitch",
  "report",
]);
export type TaskType = z.infer<typeof TaskType>;

export const AgentRole = z.enum([
  "ORCHESTRATOR",
  "SCOUT",
  "SCRIBE",
  "BUILDER",
  "CALLER",
  "LEDGER",
]);
export type AgentRole = z.infer<typeof AgentRole>;

export const CallDisposition = z.enum([
  "interested",
  "not_interested",
  "voicemail",
  "callback_requested",
  "do_not_call",
  "no_answer",
]);
export type CallDisposition = z.infer<typeof CallDisposition>;

export const HistoryEvent = z.object({
  at: z.string(),
  event: z.string(),
  by: z.string(),
  note: z.string().optional(),
});
export type HistoryEvent = z.infer<typeof HistoryEvent>;

export const CallOutcome = z.object({
  disposition: CallDisposition.nullable().default(null),
  transcript_url: z.string().nullable().default(null),
  recording_url: z.string().nullable().default(null),
  duration_seconds: z.number().nullable().default(null),
  recorded_with_consent: z.boolean().nullable().default(null),
});
export type CallOutcome = z.infer<typeof CallOutcome>;

export const HumanApproval = z.object({
  required: z.boolean().default(true),
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  notes: z.string().default(""),
});
export type HumanApproval = z.infer<typeof HumanApproval>;

export const Task = z.object({
  id: z.string(),
  lead: z.string().nullable().default(null),
  // Extension beyond the README schema: needed so the CLI can run the DNC
  // check (README §10.6) at create/claim time without opening the lead
  // artifact file. Only meaningful for type "call_pitch".
  lead_phone: z.string().nullable().default(null),
  type: TaskType,
  title: z.string(),
  spec: z.string().default(""),
  acceptance_criteria: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
  assigned_role: AgentRole,
  status: TaskStatus.default("queued"),
  priority: z.number().default(3),
  claimed_by: z.string().nullable().default(null),
  claimed_at: z.string().nullable().default(null),
  deadline: z.string().nullable().default(null),
  artifacts: z.array(z.string()).default([]),
  call_outcome: CallOutcome.default({}),
  history: z.array(HistoryEvent).default([]),
  human_approval: HumanApproval.default({}),
});
export type Task = z.infer<typeof Task>;

export const TaskCreateInput = Task.pick({
  lead: true,
  lead_phone: true,
  type: true,
  title: true,
  spec: true,
  acceptance_criteria: true,
  depends_on: true,
  assigned_role: true,
  priority: true,
  deadline: true,
}).partial({
  lead: true,
  lead_phone: true,
  spec: true,
  acceptance_criteria: true,
  depends_on: true,
  priority: true,
  deadline: true,
});
export type TaskCreateInput = z.infer<typeof TaskCreateInput>;
