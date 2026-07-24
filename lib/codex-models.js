import { spawn } from "node:child_process";

const REQUEST_TIMEOUT_MS = 15_000;
const CATALOG_TIMEOUT_MS = 30_000;
const MAX_CATALOG_PAGES = 100;
const MAX_CATALOG_RECORDS = 10_000;
const MAX_CATALOG_BYTES = 1_048_576;
const MAX_PAGE_RECORDS = 1_000;
const MAX_STDOUT_BYTES = 1_048_576;
const MAX_STDERR_BYTES = 65_536;

/** Normalizes the only catalog accepted by setup: Codex app-server model/list. */
export function normalizeCatalog(result) {
  const entries = result?.data;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Codex app-server returned no models.");
  const catalog = entries.map((entry) => {
    const model = entry?.model;
    const options = entry?.supportedReasoningEfforts;
    if (typeof model !== "string" || !model || entry.hidden !== false || !Array.isArray(options)) {
      throw new Error("Codex app-server returned an invalid model catalog entry.");
    }
    const efforts = options.map((option) => option?.reasoningEffort);
    if (efforts.some((effort) => typeof effort !== "string" || !effort)) {
      throw new Error("Codex app-server returned an invalid model catalog entry.");
    }
    if (new Set(efforts).size !== efforts.length || efforts.length === 0) {
      throw new Error(`Codex app-server returned duplicate or empty reasoning efforts for model: ${model}.`);
    }
    return { model, efforts };
  });
  const models = new Set();
  for (const { model } of catalog) {
    if (models.has(model)) throw new Error(`Codex app-server returned duplicate model catalog entry: ${model}.`);
    models.add(model);
  }
  return catalog;
}

/**
 * Starts a short-lived Codex app-server session and requests every page of its
 * effective model/list catalog. `request` is injectable for embedded callers
 * and must return the JSON-RPC result object for each request.
 */
export async function discoverCodexModels({ request, command = "codex", cwd = process.cwd(), env = process.env } = {}) {
  let transport = request;
  let close;
  let stderr;
  if (!transport) ({ request: transport, close, stderr } = await appServerTransport(command, cwd, env));
  try {
    const catalog = await collectCatalog(transport);
    if (stderr?.()) throw new Error(`Codex app-server wrote to stderr: ${stderr().trim()}`);
    return catalog;
  } finally {
    await close?.();
  }
}

async function collectCatalog(request) {
  const entries = [];
  const seenCursors = new Set();
  const startedAt = Date.now();
  let bytes = 0;
  let cursor;
  while (true) {
    if (Date.now() - startedAt > CATALOG_TIMEOUT_MS) throw new Error("Codex app-server exceeded the model catalog time limit.");
    if (seenCursors.size >= MAX_CATALOG_PAGES) throw new Error("Codex app-server exceeded the model catalog page limit.");
    const params = cursor === undefined ? { includeHidden: false } : { cursor, includeHidden: false };
    const page = validateModelPage(await request("model/list", params));
    if (Date.now() - startedAt > CATALOG_TIMEOUT_MS) throw new Error("Codex app-server exceeded the model catalog time limit.");
    if (page.data.length > MAX_PAGE_RECORDS) throw new Error("Codex app-server exceeded the model catalog page record limit.");
    entries.push(...page.data);
    if (entries.length > MAX_CATALOG_RECORDS) throw new Error("Codex app-server exceeded the model catalog record limit.");
    bytes += Buffer.byteLength(JSON.stringify(page));
    if (bytes > MAX_CATALOG_BYTES) throw new Error("Codex app-server exceeded the model catalog byte limit.");
    if (page.nextCursor === null) break;
    if (seenCursors.has(page.nextCursor)) throw new Error("Codex app-server returned a repeated model catalog cursor.");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return normalizeCatalog({ data: entries });
}

function validateModelPage(page) {
  if (
    !page ||
    typeof page !== "object" ||
    Array.isArray(page) ||
    !Array.isArray(page.data) ||
    !Object.hasOwn(page, "nextCursor")
  ) {
    throw new Error("Codex app-server returned an invalid model catalog page.");
  }
  if (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor)) {
    throw new Error("Codex app-server returned an invalid model catalog page cursor.");
  }
  return page;
}

function appServerTransport(command, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["app-server", "--stdio"], { cwd, stdio: ["pipe", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let nextId = 1;
    let closePromise;
    let pending;
    let closed = false;

    const diagnostics = () => stderr ? ` stderr: ${stderr.trim()}` : "";
    const fail = (message) => {
      if (closed) return;
      closed = true;
      const active = pending;
      clearPending();
      active?.reject(new Error(`${message}${diagnostics()}`));
      child.kill();
      reject(new Error(`${message}${diagnostics()}`));
    };
    const clearPending = () => {
      if (!pending) return;
      clearTimeout(pending.timer);
      pending = undefined;
    };
    const send = (method, params) => new Promise((resolveRequest, rejectRequest) => {
      if (closed) return rejectRequest(new Error("Codex app-server session is closed."));
      if (pending) return rejectRequest(new Error("Codex app-server received concurrent requests."));
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending?.id !== id) return;
        pending.reject(new Error(`Codex app-server timed out waiting for ${method}.${diagnostics()}`));
        fail(`Codex app-server timed out waiting for ${method}.`);
      }, REQUEST_TIMEOUT_MS);
      pending = { id, method, resolve: resolveRequest, reject: rejectRequest, timer };
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (error) fail(`unable to write ${method} to Codex app-server: ${error.message}`);
      });
    });
    const notify = (method, params) => new Promise((resolveNotification, rejectNotification) => {
      if (closed) return rejectNotification(new Error("Codex app-server session is closed."));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`, (error) => {
        if (error) {
          fail(`unable to write ${method} to Codex app-server: ${error.message}`);
          rejectNotification(error);
        } else {
          resolveNotification();
        }
      });
    });

    child.once("error", (error) => fail(`unable to start Codex app-server: ${error.message}`));
    child.stderr.on("data", (data) => {
      stderrBytes += data.length;
      if (stderrBytes > MAX_STDERR_BYTES) return fail("Codex app-server exceeded the stderr limit.");
      stderr += data;
    });
    child.stdout.on("data", (data) => {
      stdoutBytes += data.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) return fail("Codex app-server exceeded the stdout limit.");
      stdout += data;
      let newline;
      while (!closed && (newline = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { fail("Codex app-server emitted malformed JSON-RPC output."); return; }
        handleMessage(message);
      }
    });
    child.once("close", (code, signal) => {
      if (!closed) fail(`Codex app-server exited before completing model/list (${signal ?? code ?? "unknown"}).`);
    });
    closePromise = new Promise((resolveClose) => child.once("close", resolveClose));

    function handleMessage(message) {
      if (!message || typeof message !== "object" || Array.isArray(message) || ("jsonrpc" in message && message.jsonrpc !== "2.0")) {
        fail("Codex app-server emitted an invalid JSON-RPC response.");
        return;
      }
      if (!("id" in message)) {
        if (typeof message.method !== "string") fail("Codex app-server emitted an invalid JSON-RPC notification.");
        return;
      }
      if (!pending || message.id !== pending.id) {
        fail("Codex app-server emitted an unexpected JSON-RPC response id.");
        return;
      }
      const current = pending;
      clearPending();
      if (("error" in message) === ("result" in message)) {
        current.reject(new Error(`Codex app-server emitted an invalid JSON-RPC response.${diagnostics()}`));
        fail("Codex app-server emitted an invalid JSON-RPC response.");
        return;
      }
      if ("error" in message) {
        const error = message.error;
        if (!error || typeof error !== "object" || typeof error.code !== "number" || typeof error.message !== "string") {
          current.reject(new Error(`Codex app-server emitted an invalid JSON-RPC error response.${diagnostics()}`));
          fail("Codex app-server emitted an invalid JSON-RPC error response.");
          return;
        }
        current.reject(new Error(`Codex app-server ${current.method} failed (${error.code}): ${error.message}.${diagnostics()}`));
        return;
      }
      if (!("result" in message)) {
        current.reject(new Error(`Codex app-server emitted an invalid JSON-RPC response.${diagnostics()}`));
        fail("Codex app-server emitted an invalid JSON-RPC response.");
        return;
      }
      current.resolve(message.result);
    }

    (async () => {
      try {
        const initialized = await send("initialize", { clientInfo: { name: "csx", version: "0.1.0" } });
        if (!initialized || typeof initialized !== "object" || Array.isArray(initialized)) {
          throw new Error("Codex app-server returned an invalid initialize response.");
        }
        await notify("initialized", {});
        if (closed) return;
        resolve({
          request: send,
          stderr: () => stderr,
          close: async () => {
            if (!closed) {
              closed = true;
              clearPending();
              child.kill();
            }
            await closePromise;
          }
        });
      } catch (error) {
        fail(error.message);
      }
    })();
  });
}
