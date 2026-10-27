import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

import { OpenClaude, OpenShell, RenameTerminal, ResumeClaude, StartQA, TermClose, TermResize, TermWrite } from '../../wailsjs/go/main/App';
import { CanResolveFilePaths, ClipboardGetText, ClipboardSetText, EventsOn } from '../../wailsjs/runtime/runtime';
import { carriesFiles, droppedPathsText } from './fileDrop';
import { clipboardAction } from './clipboard';
import { bridgeHangulInput } from './hangulInput';
import { isMac } from '../lib/platform';
import { base64ToBytes } from '../lib/workspaceDraft';
import type { TabHost } from '../tabs/tabHost';
import { EarlyEvents, type TermExit } from './earlyEvents';
import { InterruptWatch } from './interrupt';

export type TerminalKind = 'claude' | 'shell';

export interface TerminalInfo {
  id: string;
  title: string;
  kind: TerminalKind;
  workspaceId: string;
  alive: boolean;
}

interface Session extends TerminalInfo {
  term: Terminal;
  fit: FitAddon;
  pane: HTMLElement;
  typedAt: number; // performance.now() of the last keystroke, 0 if none
}

interface WailsRuntime {
  runtime: { ResolveFilePaths(x: number, y: number, files: File[]): void };
}

interface TermData {
  id: string;
  data: string;
}

// Matches tokens.css; xterm needs literal colours.
const THEME = {
  background: '#1e1f22',
  foreground: '#e3e5e8',
  cursor: '#e3e5e8',
  selectionBackground: '#3a3c4280',
};

const BASE_FONT = 13;
/** Focus in/out reports the terminal sends on its own; not typing. */
const FOCUS_REPORT = /^\x1b\[[IO]$/;
/** Pause between a typed prompt and its Enter, so Claude sees two inputs. */
const SUBMIT_DELAY_MS = 150;

// Strip C0 control characters so an error string cannot inject escape sequences.
// eslint-disable-next-line no-control-regex
const stripControl = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, ' ');

export class TerminalPanel {
  private readonly sessions = new Map<string, Session>();
  private readonly early = new EarlyEvents();
  private readonly unsubscribe: Array<() => void>;
  private readonly resizeObserver: ResizeObserver;
  // Launches run one at a time (each measures its pane), in order, never dropped.
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(list: TerminalInfo[]) => void>();
  private readonly interrupts = new InterruptWatch();
  private fontScale = 1;
  private readonly interruptListeners = new Set<(id: string) => void>();

  // Late events for tabs the user already closed are dropped, not buffered.
  private readonly closed = new Set<string>();

  // The terminal a file drop landed on, until Wails reports the file paths.
  private dropTarget: string | undefined;
  private readonly dropListeners = new AbortController();

  constructor(
    private readonly tabs: TabHost,
    private readonly body: HTMLElement,
    private readonly onError: (message: string) => void,
  ) {
    this.unsubscribe = [
      EventsOn('term:data', (ev: TermData) => this.handleData(ev)),
      EventsOn('term:exit', (ev: TermExit) => this.handleExit(ev)),
      EventsOn('wails:file-drop', (x: number, y: number, paths: string[]) => this.handleFileDrop(x, y, paths)),
    ];
    this.resizeObserver = new ResizeObserver(() => this.fitActive());
    this.resizeObserver.observe(body);
    this.wireFileDrop();
  }

  /**
   * Files dropped on a terminal are typed in as paths. The web view does not
   * expose a dropped file's path, so on Windows the files go to Wails, which
   * answers with a wails:file-drop event; macOS and Linux send that event
   * natively.
   */
  private wireFileDrop() {
    const { signal } = this.dropListeners;
    this.body.addEventListener(
      'dragover',
      (e) => {
        if (!carriesFiles(e) || !this.activeSession()?.alive) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      },
      { signal },
    );
    this.body.addEventListener(
      'drop',
      (e) => {
        const s = this.activeSession();
        if (!carriesFiles(e) || !s?.alive) return;
        e.preventDefault();
        const files = [...(e.dataTransfer?.files ?? [])];
        if (!files.length || !CanResolveFilePaths()) return;
        this.dropTarget = s.id;
        // The generated ResolveFilePaths wrapper drops x and y, so call the runtime directly.
        (window as unknown as WailsRuntime).runtime.ResolveFilePaths(Math.round(e.clientX), Math.round(e.clientY), files);
      },
      { signal },
    );
  }

  private handleFileDrop(x: number, y: number, paths: string[]) {
    const id = this.dropTarget;
    this.dropTarget = undefined;
    // Without a drop seen here (macOS, Linux), only a drop inside the terminal area counts.
    const s = id ? this.sessions.get(id) : this.inBody(x, y) ? this.activeSession() : undefined;
    const text = droppedPathsText(paths, !navigator.userAgent.includes('Windows'));
    if (!s?.alive || !text) return;
    s.term.paste(text);
    s.term.focus();
  }

  /**
   * Types a one-line prompt into a live terminal and submits it. Enter goes
   * separately: inside a (bracketed) paste it would be a newline, not submit.
   */
  /** Whether the user typed into the terminal after the given time (performance.now()). */
  typedSince(id: string, since: number): boolean {
    return (this.sessions.get(id)?.typedAt ?? 0) >= since;
  }

  submit(id: string, text: string): boolean {
    const s = this.sessions.get(id);
    if (!s?.alive) return false;
    s.term.paste(text);
    window.setTimeout(() => {
      if (s.alive) TermWrite(s.id, '\r').catch((err) => this.onError(String(err)));
    }, SUBMIT_DELAY_MS);
    return true;
  }

  private inBody(x: number, y: number): boolean {
    const r = this.body.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private activeSession(): Session | undefined {
    const id = this.tabs.activeId;
    return id ? this.sessions.get(id) : undefined;
  }

  /**
   * Terminals are left out of the CSS zoom (xterm maps the mouse wrongly
   * under it), so a zoomed UI gets larger terminal text instead.
   */
  setFontScale(scale: number): void {
    this.fontScale = scale;
    for (const s of this.sessions.values()) {
      s.term.options.fontSize = BASE_FONT * scale;
      this.fit(s);
    }
  }

  /** Notified when the user stops a Claude request with Esc (Claude Code sends no hook for it). */
  onInterrupt(listener: (id: string) => void): void {
    this.interruptListeners.add(listener);
  }

  /** Notified whenever terminals open, close or exit (used by the office floor). */
  onChange(listener: (list: TerminalInfo[]) => void): void {
    this.listeners.add(listener);
  }

  list(): TerminalInfo[] {
    return [...this.sessions.values()].map(({ id, title, kind, workspaceId, alive }) => ({
      id,
      title,
      kind,
      workspaceId,
      alive,
    }));
  }

  private changed() {
    const list = this.list();
    for (const l of this.listeners) {
      try {
        l(list);
      } catch (err) {
        console.error('terminal listener failed', err);
      }
    }
  }

  async open(kind: TerminalKind, workspaceId: string): Promise<void> {
    const openFn = kind === 'claude' ? OpenClaude : OpenShell;
    return this.start(kind, workspaceId, (cols, rows) => openFn(workspaceId, cols, rows));
  }

  /** Resumes an earlier Claude session of a workspace. */
  resume(workspaceId: string, sessionId: string): Promise<void> {
    return this.start('claude', workspaceId, (cols, rows) => ResumeClaude(workspaceId, sessionId, cols, rows));
  }

  /** Runs a qa-2pass step for a workspace in a new Claude tab. */
  startQA(workspaceId: string, feature: string, mode: string): Promise<void> {
    return this.start('claude', workspaceId, (cols, rows) => StartQA(workspaceId, feature, mode, cols, rows));
  }

  private start(
    kind: TerminalKind,
    workspaceId: string,
    launch: (cols: number, rows: number) => Promise<{ id: string; title: string; dir: string }>,
  ): Promise<void> {
    const run = this.queue.then(() => this.launch(kind, workspaceId, launch));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async launch(
    kind: TerminalKind,
    workspaceId: string,
    launch: (cols: number, rows: number) => Promise<{ id: string; title: string; dir: string }>,
  ): Promise<void> {
    const pane = document.createElement('div');
    pane.className = 'term-pane';
    // The pane must be in the DOM and visible for xterm to measure its size.
    pane.style.visibility = 'hidden';
    pane.classList.add('tab-pane', 'active');
    this.body.append(pane);
    let term: Terminal | undefined;
    let session: Session;
    let dir: string;
    try {
      term = new Terminal({
        theme: THEME,
        fontFamily: "'Cascadia Mono', Consolas, monospace",
        fontSize: BASE_FONT * this.fontScale,
        cursorBlink: true,
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(pane);
      // macOS WebKit gets no composition events from the Korean IME (see hangulInput.ts).
      if (isMac()) {
        const t = term;
        bridgeHangulInput(pane, (data) => t.input(data, true));
      }
      fit.fit();

      const info = await launch(term.cols, term.rows);
      session = { id: info.id, title: info.title, kind, workspaceId, alive: true, term, fit, pane, typedAt: 0 };
      dir = info.dir;
    } catch (err) {
      term?.dispose();
      pane.remove();
      this.onError(String(err));
      return;
    }
    // Outside the try: the process is running now, so a UI error must not
    // dispose its terminal and orphan it.
    pane.style.visibility = '';
    this.register(session, dir);
  }

  private register(session: Session, dir: string) {
    this.sessions.set(session.id, session);
    session.term.onData((data) => {
      if (!FOCUS_REPORT.test(data)) session.typedAt = performance.now();
      if (session.alive) TermWrite(session.id, data).catch((err) => this.onError(String(err)));
    });
    this.wireClipboard(session);
    this.tabs.add({
      id: session.id,
      title: session.title,
      tooltip: dir,
      kind: session.kind,
      group: session.workspaceId,
      onRename: async (name) => {
        try {
          await RenameTerminal(session.id, name);
          session.title = name;
          this.changed();
          return true;
        } catch (err) {
          this.onError(String(err));
          return false;
        }
      },
      pane: session.pane,
      onActivate: () => {
        this.fit(session);
        session.term.focus();
      },
      onClose: () => void this.close(session.id),
    });
    const { chunks, exit } = this.early.take(session.id);
    for (const chunk of chunks) session.term.write(chunk);
    if (exit) this.markExited(session, exit);
    this.changed();
  }

  /**
   * Windows Terminal style clipboard: Ctrl+C copies a selection (and is ^C
   * otherwise), Ctrl+V pastes, right-click copies a selection or pastes.
   */
  private wireClipboard(session: Session) {
    const { term } = session;
    const copy = () => {
      const text = term.getSelection();
      if (!text) return;
      ClipboardSetText(text).catch((err) => this.onError(`복사하지 못했습니다: ${String(err)}`));
      term.clearSelection();
    };
    const paste = () => {
      ClipboardGetText()
        .then((text) => {
          // paste() applies bracketed paste; strip markers so pasted text cannot end it early.
          // eslint-disable-next-line no-control-regex
          if (text && session.alive) term.paste(text.replace(/\x1b\[20[01]~/g, ''));
        })
        .catch((err) => this.onError(`붙여넣지 못했습니다: ${String(err)}`));
    };
    term.attachCustomKeyEventHandler((e) => {
      const action = clipboardAction(e, term.hasSelection(), isMac());
      if (!action) return true;
      // Stop the browser's own paste event too, or the text would arrive twice.
      e.preventDefault();
      if (action === 'copy') copy();
      else paste();
      return false;
    });
    session.pane.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (term.hasSelection()) copy();
      else paste();
    });
  }

  private handleData(ev: TermData) {
    const bytes = base64ToBytes(ev.data);
    const session = this.sessions.get(ev.id);
    if (session) {
      session.term.write(bytes);
      if (session.kind === 'claude' && this.interrupts.feed(ev.id, bytes)) for (const l of this.interruptListeners) l(ev.id);
    } else if (!this.closed.has(ev.id)) this.early.data(ev.id, bytes);
  }

  private handleExit(ev: TermExit) {
    const session = this.sessions.get(ev.id);
    if (session) this.markExited(session, ev);
    else if (this.closed.delete(ev.id)) return;
    else this.early.exit(ev.id, ev);
  }

  private markExited(session: Session, ev: TermExit) {
    session.alive = false;
    this.tabs.mark(session.id, 'exited');
    const reason = ev.error ? `: ${stripControl(ev.error)}` : '';
    session.term.write(`\r\n\x1b[90m[프로세스 종료${reason}]\x1b[0m\r\n`);
    this.changed();
  }

  private fit(s: Session) {
    if (s.pane.clientWidth === 0) return;
    const { cols, rows } = s.term;
    s.fit.fit();
    if (s.alive && (s.term.cols !== cols || s.term.rows !== rows)) {
      TermResize(s.id, s.term.cols, s.term.rows).catch(() => {
        // The process may have just exited; the exit event will update the tab.
      });
    }
  }

  private fitActive() {
    const s = this.activeSession();
    if (s) this.fit(s);
  }

  async close(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    this.interrupts.forget(id);
    if (s.alive) {
      this.closed.add(id); // its exit event is still to come
      try {
        await TermClose(id);
      } catch {
        // Already gone.
      }
    }
    s.term.dispose();
    this.tabs.remove(id);
    this.changed();
  }

  /** Releases listeners and terminals (used by Vite HMR). Processes keep running. */
  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.resizeObserver.disconnect();
    this.dropListeners.abort();
    for (const s of this.sessions.values()) s.term.dispose();
    this.sessions.clear();
  }
}
