/**
 * Files dropped on a terminal are typed into it as paths, the way Cursor and
 * VS Code do it. Claude Code turns a pasted image path into an attached image
 * and reads other files from their path.
 */

// cmd.exe and PowerShell treat these specially outside quotes.
const WINDOWS_SPECIAL = /[\s&()[\]{}^=;!'+,`~%$@#]/;
// sh/zsh: escape each special character with a backslash, as macOS Terminal does.
const POSIX_SPECIAL = /[\s!"#$&'()*;<>?[\\\]^`{|}~]/g;

function quote(path: string, posix: boolean): string {
  if (posix) return path.replace(POSIX_SPECIAL, (c) => `\\${c}`);
  // Windows file names cannot contain ", so wrapping in quotes is enough.
  return WINDOWS_SPECIAL.test(path) ? `"${path}"` : path;
}

/** The text to type for dropped paths: quoted, space separated, with a trailing space. */
export function droppedPathsText(paths: string[], posix: boolean): string {
  const parts = paths.filter(Boolean).map((p) => quote(p, posix));
  return parts.length ? `${parts.join(' ')} ` : '';
}

export const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

/**
 * Without this, a file dropped anywhere but a terminal makes the web view
 * navigate to it and the dashboard disappears. Terminals accept the drag
 * first (they call preventDefault), so those drags are left alone.
 */
export function blockStrayFileDrops(target: Window): () => void {
  const onOver = (e: DragEvent) => {
    if (!carriesFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  const onDrop = (e: DragEvent) => {
    if (carriesFiles(e)) e.preventDefault();
  };
  target.addEventListener('dragover', onOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onOver);
    target.removeEventListener('drop', onDrop);
  };
}
