import { getServerEnvironment } from "@/config/server-env";

export function register(): void {
  getServerEnvironment();
}
