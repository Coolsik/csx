import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { install, uninstall } from "../lib/install.js";
import { readLocalDiagnostics } from "../lib/local-diagnostics.js";
import {
  WORKFLOW_STATE_PATH,
  readWorkflowState,
  runWorkflowOperation
} from "../lib/workflow-state.js";

const cli = resolve("bin/csx.js");

test("real non-Git lifecycle keeps one installed ancestor root and fails closed on residue", async () => {
  const base = await mkdtemp(join(tmpdir(), "csx-non-git-lifecycle-"));
  const root = join(base, "project");
  const nested = join(root, "packages", "app");
  const global = join(base, "global");
  const artifact = ".csx/goals/non-git.md";
  try {
    await mkdir(nested, { recursive: true });
    await mkdir(global);
    await mkdir(join(root, ".csx", "goals"), { recursive: true });
    await writeFile(join(root, artifact), "R000\n");
    await install({ scope: "global", env: { CODEX_HOME: global } });
    await install({ scope: "project", projectRoot: root });

    const beginRun = await runCommand(process.execPath, [cli, "workflow", "begin"], {
      cwd: nested,
      env: { ...process.env, CODEX_HOME: global },
      input: JSON.stringify({
        version: 1,
        workflow: "csx-start-goal",
        phase: "implementation",
        artifact
      })
    });
    assert.equal(beginRun.code, 0);
    const begin = JSON.parse(beginRun.stdout);
    /* The public request intentionally omits projectRoot, as the workflow skill does. */
    assert.equal(begin.ok, true);
    assert.equal((await readWorkflowState({ cwd: nested })).ok, true);

    const projectHook = join(root, ".codex", "hooks", "csx-hook.mjs");
    const projectSession = await runHook(projectHook, "session-start", "project", root, {
      hook_event_name: "SessionStart",
      source: "resume",
      cwd: nested
    });
    assert.equal(JSON.parse(projectSession.stdout).hookSpecificOutput.hookEventName, "SessionStart");

    for (const last_assistant_message of [
      null,
      "done\n<!-- csx-metrics:v1 {\"status\":\"completed\",\"reason_code\":\"ok\"} -->"
    ]) {
      await runHook(projectHook, "subagent-stop", "project", root, {
        hook_event_name: "SubagentStop",
        cwd: nested,
        agent_type: "csx-executor",
        last_assistant_message
      });
    }
    const diagnostics = await readLocalDiagnostics({ cwd: nested, codexHome: global });
    assert.equal(diagnostics.scope, "project");
    assert.equal(diagnostics.events.length, 2);
    assert.equal(diagnostics.events.filter(({ status }) => status === "completed").length, 1);
    assert.equal(diagnostics.events.filter(({ status }) => status === undefined).length, 1);
    const diagnosticsCli = await runCommand(process.execPath, [cli, "diagnostics", "--json"], {
      cwd: nested,
      env: { ...process.env, CODEX_HOME: global }
    });
    assert.equal(diagnosticsCli.code, 0);
    assert.equal(JSON.parse(diagnosticsCli.stdout).events.length, 2);

    await uninstall({ projectRoot: root, env: { CODEX_HOME: global } });
    assert.equal((await readFile(join(root, WORKFLOW_STATE_PATH), "utf8")).includes(begin.token), true);
    const globalHook = join(global, "hooks", "csx-hook.mjs");
    const fallback = await runHook(globalHook, "session-start", "global", global, {
      hook_event_name: "SessionStart",
      source: "resume",
      cwd: nested
    });
    assert.equal(JSON.parse(fallback.stdout).hookSpecificOutput.hookEventName, "SessionStart");
    const fallbackDiagnostics = await readLocalDiagnostics({ cwd: nested, codexHome: global });
    assert.equal(fallbackDiagnostics.scope, "global");
    assert.equal(fallbackDiagnostics.events.length, 2);

    const config = join(root, ".codex", "config.toml");
    await mkdir(dirname(config), { recursive: true });
    await writeFile(config, "# >>> csx managed >>>\n");
    assert.equal((await runHook(globalHook, "session-start", "global", global, {
      hook_event_name: "SessionStart",
      source: "resume",
      cwd: nested
    })).stdout, "");
    const beforeEvents = await eventNames(root);
    await runHook(globalHook, "subagent-stop", "global", global, {
      hook_event_name: "SubagentStop",
      cwd: nested,
      agent_type: "csx-executor",
      last_assistant_message: null
    });
    assert.deepEqual(await eventNames(root), beforeEvents);
    await assert.rejects(
      readLocalDiagnostics({ cwd: nested, codexHome: global }),
      /unsafe project csx installation authority/
    );

    await rm(join(root, WORKFLOW_STATE_PATH));
    const blocked = await runWorkflowOperation("begin", {
      version: 1,
      workflow: "csx-start-goal",
      phase: "must-not-create",
      artifact
    }, { cwd: nested });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "state_unavailable");
    await assert.rejects(readFile(join(root, WORKFLOW_STATE_PATH)), { code: "ENOENT" });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

async function runHook(hook, operation, scope, authorityRoot, payload) {
  return runCommand(process.execPath, [
    hook,
    operation,
    "--authority-scope",
    scope,
    "--authority-root",
    authorityRoot
  ], { cwd: payload.cwd, input: JSON.stringify(payload) });
}

async function runCommand(command, args, { cwd, env, input = "" }) {
  return new Promise((resolveRun) => {
    const child = execFile(command, args, { cwd, env, encoding: "utf8" }, (error, stdout, stderr) => {
      resolveRun({ code: error?.code ?? 0, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function eventNames(root) {
  return (await readdir(join(root, ".csx", "diagnostics-v1")).catch(() => []))
    .filter((name) => /^event-\d{4}\.json$/.test(name))
    .sort();
}
