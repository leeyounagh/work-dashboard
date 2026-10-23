/** Files Claude showed or touched in one workspace. */
export interface FileState {
  opened: string[]; // open_files requests, newest first
  seen: Array<{ path: string; tool: string }>; // Read/Edit/Write hooks, newest first
}

const MAX_SEEN = 20;
const MAX_OPENED = 50;

export function emptyFileState(): FileState {
  return { opened: [], seen: [] };
}

export function addOpened(state: FileState, paths: string[]): FileState {
  const fresh = [...paths].reverse();
  const rest = state.opened.filter((p) => !paths.includes(p));
  return { ...state, opened: [...fresh, ...rest].slice(0, MAX_OPENED) };
}

export function addSeen(state: FileState, path: string, tool: string): FileState {
  const rest = state.seen.filter((e) => e.path !== path);
  return { ...state, seen: [{ path, tool }, ...rest].slice(0, MAX_SEEN) };
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Shows a path relative to the workspace folder containing it (keeping the folder name). */
export function relativeTo(path: string, folders: string[]): string {
  const lower = path.toLowerCase();
  for (const folder of folders) {
    const f = folder.replace(/[\\/]+$/, '');
    if (lower.startsWith(f.toLowerCase() + '\\') || lower.startsWith(f.toLowerCase() + '/')) {
      return baseName(f) + path.slice(f.length);
    }
  }
  return path;
}

export type Language =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'json'
  | 'markdown'
  | 'css'
  | 'html'
  | 'python'
  | 'go'
  | 'yaml'
  | 'sql'
  | 'java'
  | 'shell'
  | 'diff'
  | 'text';

const BY_EXTENSION: Record<string, Language> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  vue: 'html',
  py: 'python',
  go: 'go',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  java: 'java',
  kt: 'java',
  dart: 'java',
  sh: 'shell',
  bash: 'shell',
  ps1: 'shell',
  diff: 'diff',
  patch: 'diff',
};

export function languageFor(path: string): Language {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'text';
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'text';
}
