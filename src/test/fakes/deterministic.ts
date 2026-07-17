export interface Clock {
  now(): Date;
}

export interface IdSource {
  next(prefix: string): string;
}

export class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }
}

export class SequentialIds implements IdSource {
  #counter = 0;

  next(prefix: string): string {
    this.#counter += 1;
    return `${prefix}_${String(this.#counter).padStart(6, "0")}`;
  }
}

export class DeterministicUuids implements IdSource {
  #counter = 0;

  next(prefix: string): string {
    void prefix;
    this.#counter += 1;
    return `00000000-0000-4000-8000-${this.#counter.toString(16).padStart(12, "0")}`;
  }
}

export class InMemoryObjectStore {
  readonly #objects = new Map<string, Uint8Array>();

  put(path: string, bytes: Uint8Array): void {
    this.#objects.set(path, new Uint8Array(bytes));
  }

  get(path: string): Uint8Array | null {
    const bytes = this.#objects.get(path);
    return bytes ? new Uint8Array(bytes) : null;
  }
}
