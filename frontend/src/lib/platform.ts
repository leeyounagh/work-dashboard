/** macOS uses Cmd where Windows and Linux use Ctrl for app shortcuts. */
export function isMac(): boolean {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return /Mac|iPhone|iPad/.test(nav?.platform || nav?.userAgent || '');
}
