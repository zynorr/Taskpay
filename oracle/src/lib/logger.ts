// Minimal structured logger. Every log line is one JSON object so logs are
// grep-able and machine-parseable on any host (Render, Docker, local tsx).
type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, context?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(context ? { context } : {}),
  });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (event: string, context?: Record<string, unknown>) => emit("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => emit("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => emit("error", event, context),
};
