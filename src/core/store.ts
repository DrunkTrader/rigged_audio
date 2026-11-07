import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { JobRecord, LibraryStore, ProjectRecord } from "../shared/types";

const CURRENT_SCHEMA = 2;

function emptyStore(): LibraryStore {
  return { schemaVersion: CURRENT_SCHEMA, projects: [], jobs: [] };
}

function migrate(value: unknown): LibraryStore {
  if (!value || typeof value !== "object") return emptyStore();
  const candidate = value as Partial<LibraryStore>;
  if (
    candidate.schemaVersion === CURRENT_SCHEMA &&
    Array.isArray(candidate.projects) &&
    Array.isArray(candidate.jobs)
  ) {
    return candidate as LibraryStore;
  }
  // v1 stems came from a test filter, not a model: keep the sources, drop the fake output.
  if (
    candidate.schemaVersion === 1 &&
    Array.isArray(candidate.projects) &&
    Array.isArray(candidate.jobs)
  ) {
    return {
      schemaVersion: CURRENT_SCHEMA,
      projects: candidate.projects.map((project) => ({
        ...project,
        stems: {},
        jobIds: [],
      })),
      jobs: [],
    };
  }
  return emptyStore();
}

export class JsonStore {
  private readonly filePath: string;
  private value: LibraryStore;

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, "library.json");
    mkdirSync(dirname(this.filePath), { recursive: true });
    try {
      this.value = migrate(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch {
      if (existsSync(this.filePath)) {
        try {
          renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
        } catch {
          /* preserve best effort */
        }
      }
      this.value = emptyStore();
    }
  }

  snapshot(): LibraryStore {
    return structuredClone(this.value);
  }

  projects(): ProjectRecord[] {
    return structuredClone(this.value.projects);
  }

  jobs(): JobRecord[] {
    return structuredClone(this.value.jobs);
  }

  replace(next: LibraryStore): void {
    const temp = `${this.filePath}.tmp`;
    writeFileSync(
      temp,
      JSON.stringify({ ...next, schemaVersion: CURRENT_SCHEMA }, null, 2),
      "utf8",
    );
    renameSync(temp, this.filePath);
    this.value = migrate(next);
  }

  update(mutator: (current: LibraryStore) => LibraryStore): void {
    this.replace(mutator(this.snapshot()));
  }

  remove(): void {
    try {
      unlinkSync(this.filePath);
    } catch {
      /* already absent */
    }
  }
}
