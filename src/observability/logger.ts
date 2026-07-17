import "server-only";

import { parseDiagnosticEvent, type DiagnosticEvent } from "@/observability/schema";

export interface DiagnosticSink {
  write(event: DiagnosticEvent): Promise<void>;
}

const consoleSink: DiagnosticSink = {
  async write(event) {
    const payload = JSON.stringify(event);
    if (event.severity === "error") {
      console.error(payload);
    } else if (event.severity === "warning") {
      console.warn(payload);
    } else {
      console.info(payload);
    }
  },
};

export async function writeDiagnostic(
  value: unknown,
  sink: DiagnosticSink = consoleSink,
): Promise<DiagnosticEvent> {
  const event = parseDiagnosticEvent(value);
  await sink.write(event);
  return event;
}
