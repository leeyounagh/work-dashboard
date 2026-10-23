export interface TermExit {
  id: string;
  error?: string;
}

interface Entry {
  chunks: Uint8Array[];
  bytes: number;
  exit?: TermExit;
}

/**
 * Holds terminal events that arrive before the frontend has registered the
 * session: the backend starts streaming as soon as the process starts, which
 * can be before OpenClaude/OpenShell resolves. A process that fails at once
 * (e.g. claude not on PATH) sends both its error output and its exit early.
 */
export class EarlyEvents {
  private readonly entries = new Map<string, Entry>();
  private readonly maxBytes: number;
  private readonly maxSessions: number;

  constructor(limits: { maxBytes: number; maxSessions: number } = { maxBytes: 1 << 20, maxSessions: 16 }) {
    this.maxBytes = limits.maxBytes;
    this.maxSessions = limits.maxSessions;
  }

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { chunks: [], bytes: 0 };
      this.entries.set(id, e);
      // Map keeps insertion order, so the first key is the oldest session.
      if (this.entries.size > this.maxSessions) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
    }
    return e;
  }

  data(id: string, chunk: Uint8Array): void {
    const e = this.entry(id);
    e.chunks.push(chunk);
    e.bytes += chunk.length;
    while (e.bytes > this.maxBytes && e.chunks.length > 1) {
      e.bytes -= e.chunks.shift()!.length;
    }
  }

  exit(id: string, ev: TermExit): void {
    this.entry(id).exit = ev;
  }

  /** Removes and returns everything buffered for a session. */
  take(id: string): { chunks: Uint8Array[]; exit: TermExit | undefined } {
    const e = this.entries.get(id);
    this.entries.delete(id);
    return { chunks: e?.chunks ?? [], exit: e?.exit };
  }
}
