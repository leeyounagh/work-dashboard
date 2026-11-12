import { pathKey } from '../files/fileState';

/** Tools that write files; their hooks put a file on a session's change list. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function isEditTool(tool: string | undefined): boolean {
  return tool !== undefined && EDIT_TOOLS.has(tool);
}

/** A file one Claude session changed. */
export interface ChangedFile {
  path: string;
  tool: string;
}

const MAX_FILES = 100;

/** Puts a file first on the list (newest first), once per path. */
export function touch(list: readonly ChangedFile[], path: string, tool: string): ChangedFile[] {
  const key = pathKey(path);
  return [{ path, tool }, ...list.filter((f) => pathKey(f.path) !== key)].slice(0, MAX_FILES);
}

export type DiffLineKind = 'hunk' | 'add' | 'del' | 'ctx' | 'note';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface ParsedDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** The file is new to git (no old side). */
  isNew: boolean;
  binary: boolean;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Reads a unified diff of one file (git diff output) into numbered lines. */
export function parseDiff(text: string): ParsedDiff {
  const out: ParsedDiff = { lines: [], added: 0, removed: 0, isNew: false, binary: false };
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      inHunk = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      out.lines.push({ kind: 'hunk', text: raw });
      continue;
    }
    if (!inHunk) {
      // File headers: only what they say about the file matters.
      if (raw.startsWith('new file') || raw === '--- /dev/null') out.isNew = true;
      if (raw.startsWith('Binary file')) out.binary = true;
      continue;
    }
    if (raw.startsWith('+')) {
      out.lines.push({ kind: 'add', text: raw.slice(1), newNo: newNo++ });
      out.added++;
    } else if (raw.startsWith('-')) {
      out.lines.push({ kind: 'del', text: raw.slice(1), oldNo: oldNo++ });
      out.removed++;
    } else if (raw.startsWith(' ')) {
      out.lines.push({ kind: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    } else if (raw.startsWith('\\')) {
      out.lines.push({ kind: 'note', text: raw.slice(1).trim() });
    } else if (raw.startsWith('diff --git')) {
      inHunk = false; // a second file: its headers follow
    }
  }
  return out;
}
