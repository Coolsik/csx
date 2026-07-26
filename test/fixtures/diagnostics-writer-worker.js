import { spawn } from "node:child_process";

if (process.argv[2] === "--run") {
  const [hook, scope, authorityRoot, payload] = process.argv.slice(3);
  const child = spawn(process.execPath, [
    hook,
    "subagent-stop",
    "--authority-scope",
    scope,
    "--authority-root",
    authorityRoot
  ], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(payload);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (code) => {
    process.stdout.write(`${JSON.stringify({ code, stdout, stderr })}\n`);
  });
}
