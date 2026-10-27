type LogLevel = "info" | "warn" | "error";

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) output[key] = /token|secret|password|authorization/i.test(key) ? "[REDACTED]" : sanitize(entry);
    return output;
  }
  return value;
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = { timestamp: new Date().toISOString(), level, service: "golden-agent-connector", event, ...sanitize(fields) as Record<string, unknown> };
  const output = JSON.stringify(line);
  if (level === "error") console.error(output); else console.log(output);
}
