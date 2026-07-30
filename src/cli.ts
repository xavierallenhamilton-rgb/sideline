#!/usr/bin/env node
import { Command } from "commander";
import {
  createTask,
  listTasks,
  getTask,
  claimTask,
  heartbeat,
  setStatus,
  addArtifact,
  approveTask,
  deliverTask,
  requestChanges,
  dncAdd,
  dncCheck,
  dncList,
  TaskBoardError,
} from "./taskboard.js";
import { AgentRole, TaskType, TaskStatus, type Task } from "./schema.js";

const program = new Command();
program.name("sideline").description("Sideline task board CLI").version("0.1.0");

function fail(err: unknown): never {
  const msg = err instanceof TaskBoardError ? err.message : String(err);
  console.error(`error: ${msg}`);
  process.exit(1);
}

function printTask(t: Task, verbose = false) {
  console.log(`${t.id}  [${t.status}]  ${t.type}  -> ${t.assigned_role}  "${t.title}"`);
  if (verbose) {
    console.log(JSON.stringify(t, null, 2));
  }
}

const task = program.command("task").description("manage tasks on the board");

task
  .command("create")
  .requiredOption("--type <type>", `one of: ${TaskType.options.join(", ")}`)
  .requiredOption("--role <role>", `assigned_role, one of: ${AgentRole.options.join(", ")}`)
  .requiredOption("--title <title>", "short title")
  .option("--lead <lead>", "lead slug, e.g. rosas-pizza-springfield")
  .option("--lead-phone <phone>", "lead's phone number (required for call_pitch DNC checks)")
  .option("--spec <spec>", "full task spec", "")
  .option("--depends-on <ids>", "comma-separated task ids this depends on")
  .option("--priority <n>", "priority, lower is more urgent", "3")
  .option("--deadline <iso>", "ISO 8601 deadline")
  .option("--by <agent>", "who is creating this task", "FOUNDER")
  .action((opts) => {
    try {
      const t = createTask(
        {
          type: TaskType.parse(opts.type),
          assigned_role: AgentRole.parse(opts.role),
          title: opts.title,
          lead: opts.lead ?? null,
          lead_phone: opts.leadPhone ?? null,
          spec: opts.spec,
          depends_on: opts.dependsOn ? opts.dependsOn.split(",").map((s: string) => s.trim()) : [],
          priority: Number(opts.priority),
          deadline: opts.deadline ?? null,
        },
        opts.by
      );
      printTask(t, true);
    } catch (err) {
      fail(err);
    }
  });

task
  .command("list")
  .option("--status <status>", "filter by status")
  .option("--role <role>", "filter by assigned_role")
  .option("--lead <lead>", "filter by lead")
  .action((opts) => {
    const status = opts.status ? TaskStatus.parse(opts.status) : undefined;
    const tasks = listTasks({ status, role: opts.role, lead: opts.lead });
    if (tasks.length === 0) {
      console.log("(no matching tasks)");
      return;
    }
    for (const t of tasks) printTask(t);
  });

task
  .command("show <id>")
  .action((id) => {
    try {
      printTask(getTask(id), true);
    } catch (err) {
      fail(err);
    }
  });

task
  .command("claim <id>")
  .requiredOption("--by <agent>", "agent name claiming this task")
  .action((id, opts) => {
    try {
      printTask(claimTask(id, opts.by), true);
    } catch (err) {
      fail(err);
    }
  });

task
  .command("heartbeat <id>")
  .requiredOption("--by <agent>", "agent name")
  .option("--note <note>", "progress note")
  .action((id, opts) => {
    try {
      printTask(heartbeat(id, opts.by, opts.note));
    } catch (err) {
      fail(err);
    }
  });

task
  .command("status <id>")
  .requiredOption("--set <status>", "new status (not approved/delivered — use approve/deliver)")
  .requiredOption("--by <agent>", "agent name")
  .option("--note <note>", "note")
  .action((id, opts) => {
    try {
      printTask(setStatus(id, opts.set, opts.by, opts.note));
    } catch (err) {
      fail(err);
    }
  });

task
  .command("add-artifact <id> <path>")
  .requiredOption("--by <agent>", "agent name")
  .action((id, artifactPath, opts) => {
    try {
      printTask(addArtifact(id, artifactPath, opts.by));
    } catch (err) {
      fail(err);
    }
  });

task
  .command("approve <id>")
  .requiredOption("--by <name>", "founder's name — this is a human-only action")
  .option("--note <note>", "approval note")
  .action((id, opts) => {
    try {
      printTask(approveTask(id, opts.by, opts.note), true);
    } catch (err) {
      fail(err);
    }
  });

task
  .command("deliver <id>")
  .requiredOption("--by <name>", "founder's name — this is a human-only action")
  .option("--note <note>", "delivery note")
  .action((id, opts) => {
    try {
      printTask(deliverTask(id, opts.by, opts.note));
    } catch (err) {
      fail(err);
    }
  });

task
  .command("request-changes <id>")
  .requiredOption("--by <name>", "founder's name")
  .requiredOption("--note <note>", "what needs to change")
  .action((id, opts) => {
    try {
      printTask(requestChanges(id, opts.by, opts.note));
    } catch (err) {
      fail(err);
    }
  });

const dnc = program.command("dnc").description("manage the do-not-call list (README §10.6)");

dnc
  .command("add <phone>")
  .requiredOption("--reason <reason>", "why this number was added")
  .action((phone, opts) => {
    const entry = dncAdd(phone, opts.reason);
    console.log(`DNC: ${entry.phone} — ${entry.reason} (${entry.added_at})`);
  });

dnc
  .command("check <phone>")
  .action((phone) => {
    const entry = dncCheck(phone);
    console.log(entry ? `BLOCKED: ${JSON.stringify(entry)}` : "clear — not on the DNC list");
  });

dnc
  .command("list")
  .action(() => {
    const entries = dncList();
    if (entries.length === 0) {
      console.log("(DNC list is empty)");
      return;
    }
    for (const e of entries) console.log(`${e.phone}  ${e.reason}  (${e.added_at})`);
  });

program.parseAsync(process.argv);
