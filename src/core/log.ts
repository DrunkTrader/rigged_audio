import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export class StructuredLogger {
  private readonly filePath: string;

  constructor(dataDirectory: string) {
    mkdirSync(join(dataDirectory, "logs"), { recursive: true });
    this.filePath = join(dataDirectory, "logs", "app.jsonl");
  }

  info(event: string, fields: Record<string, string | number | boolean>): void {
    appendFileSync(
      this.filePath,
      `${JSON.stringify({ at: new Date().toISOString(), level: "info", event, ...fields })}\n`,
    );
  }

  error(
    event: string,
    fields: Record<string, string | number | boolean>,
  ): void {
    appendFileSync(
      this.filePath,
      `${JSON.stringify({ at: new Date().toISOString(), level: "error", event, ...fields })}\n`,
    );
  }
}
