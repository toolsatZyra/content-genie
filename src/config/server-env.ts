import "server-only";

import { parseServerEnvironment, type ServerEnvironment } from "@/config/env-core";

let cached: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  cached ??= parseServerEnvironment(process.env);
  return cached;
}
