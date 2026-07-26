const PREFIX = "<!-- csx-metrics:v1 ";
const SUFFIX = " -->";

export function diagnosticTrailer(json) {
  return `${PREFIX}${json}${SUFFIX}`;
}

function exactLine(bytes) {
  const fixed = Buffer.byteLength(`${PREFIX}{"padding":""}${SUFFIX}`);
  return diagnosticTrailer(`{"padding":"${"x".repeat(bytes - fixed)}"}`);
}

export const diagnosticTrailerCorpus = Object.freeze([
  { name: "missing", response: "normal body", expected: {} },
  { name: "LF final", response: `body\n${diagnosticTrailer('{"status":"completed"}')}`, expected: { status: "completed" } },
  { name: "CRLF and trailing blanks", response: `body\r\n${diagnosticTrailer('{"status":"blocked"}')}\r\n\r\n`, expected: { status: "blocked" } },
  { name: "non-final", response: `${diagnosticTrailer('{"status":"completed"}')}\nbody`, expected: {} },
  { name: "attached", response: `body ${diagnosticTrailer('{"status":"completed"}')}`, expected: {} },
  { name: "exact 6144", response: exactLine(6_144), expected: {} },
  { name: "6145", response: exactLine(6_145), expected: {} },
  { name: "malformed", response: diagnosticTrailer("{"), expected: {} },
  { name: "nonobject", response: diagnosticTrailer("[]"), expected: {} },
  { name: "unknown ignored", response: diagnosticTrailer('{"unknown":"raw"}'), expected: {} },
  { name: "valid siblings", response: diagnosticTrailer('{"status":"failed","reason_code":"tool_error","failure_detail":"bounded"}'), expected: { status: "failed", reason_code: "tool_error", failure_detail: "bounded" } },
  { name: "invalid status", response: diagnosticTrailer('{"status":"other","reason_code":"ok"}'), expected: { reason_code: "ok" } },
  { name: "duplicate status", response: diagnosticTrailer('{"status":"failed","status":"blocked","reason_code":"ok"}'), expected: { reason_code: "ok" } },
  { name: "invalid reason", response: diagnosticTrailer('{"status":"failed","reason_code":"BAD","failure_detail":"drop"}'), expected: { status: "failed" } },
  { name: "duplicate reason", response: diagnosticTrailer('{"reason_code":"one","reason_code":"two","failure_detail":"drop"}'), expected: {} },
  { name: "detail missing reason", response: diagnosticTrailer('{"failure_detail":"drop"}'), expected: {} },
  { name: "detail invalid type", response: diagnosticTrailer('{"reason_code":"ok","failure_detail":1}'), expected: { reason_code: "ok" } },
  { name: "duplicate detail", response: diagnosticTrailer('{"reason_code":"ok","failure_detail":"one","failure_detail":"two"}'), expected: { reason_code: "ok" } },
  { name: "valid multibyte detail", response: diagnosticTrailer(`{"reason_code":"ok","failure_detail":"${"가".repeat(682)}"}`), expected: { reason_code: "ok", failure_detail: "가".repeat(682) } },
  { name: "oversize multibyte detail", response: diagnosticTrailer(`{"status":"failed","reason_code":"ok","failure_detail":"${"가".repeat(683)}"}`), expected: { status: "failed", reason_code: "ok" } },
  { name: "oversize detail invalid reason", response: diagnosticTrailer(`{"status":"failed","reason_code":"BAD","failure_detail":"${"가".repeat(683)}"}`), expected: { status: "failed" } },
]);
