import type { Workspace } from './widgets';

/** A blank workspace; the backend assigns the ID on first save. */
export function emptyDraft(): Workspace {
  return { id: '', name: '', folders: [], widgets: [], notes: '' };
}

// Windows paths are case-insensitive and may arrive with a trailing separator.
const folderKey = (path: string) => path.replace(/[\\/]+$/, '').toLowerCase();

export function addFolder(ws: Workspace, path: string): Workspace {
  if (!path) return ws;
  const key = folderKey(path);
  if (ws.folders.some((f) => folderKey(f) === key)) return ws;
  return { ...ws, folders: [...ws.folders, path] };
}

export function removeFolder(ws: Workspace, index: number): Workspace {
  return { ...ws, folders: ws.folders.filter((_, i) => i !== index) };
}

export function isDirty(saved: Workspace, draft: Workspace): boolean {
  return (
    saved.name !== draft.name ||
    (saved.notes ?? '') !== (draft.notes ?? '') ||
    saved.folders.length !== draft.folders.length ||
    saved.folders.some((f, i) => f !== draft.folders[i])
  );
}

/** Terminal output arrives base64-encoded so partial UTF-8 sequences survive. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
