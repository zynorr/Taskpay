import fs from "node:fs";

// Minimal structured logger. Every log line is one JSON object so logs are
// grep-able and machine-parseable on any host (Render, Docker, local tsx).
//
// Lines are written synchronously (fs.writeSync, not console.log): when
// stdout is redirected to a file or pipe, Node buffers console output, and on
// Windows that lag can be minutes — a healthy daemon starts to look wedged and
// a genuinely stuck one hides its last error. A daemon's logs must be
// real-time and durable.
type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, context?: Record<string, unknown>): void {
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...(context ? { context } : {}),
    }) + "\n";
  // info → stdout; warn/error → stderr (matching console semantics). writeSync
  // is atomic for these small lines, so concurrent writers cannot interleave.
  const fd = level === "info" ? 1 : 2;
  fs.writeSync(fd, line);
}

export const logger = {
  info: (event: string, context?: Record<string, unknown>) => emit("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => emit("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => emit("error", event, context),
};
