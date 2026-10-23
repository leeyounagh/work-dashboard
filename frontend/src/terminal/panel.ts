import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

import { OpenClaude, OpenShell, TermClose, TermResize, TermWrite } from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { base64ToBytes } from '../lib/workspaceDraft';
import { EarlyEvents, type TermExit } from './earlyEvents';

export type TerminalKind = 'claude' | 'shell';

interface Session {
  id: string;
  term: Terminal;
  fit: FitAddon;
  tab: HTMLElement;
  pane: HTMLElement;
  alive: boolean;
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

// Strip C0 control characters so an error string cannot inject escape sequences.
// eslint-disable-next-line no-control-regex
const stripControl = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, ' ');

export class TerminalPanel {
  private readonly sessions = new Map<string, Session>();
  private readonly early = new EarlyEvents();
  private readonly unsubscribe: Array<() => void>;
  private readonly resizeObserver: ResizeObserver;
  private active: string | null = null;
  private opening = false;

  constructor(
    private readonly tabs: HTMLElement,
    private readonly body: HTMLElement,
    private readonly onError: (message: string) => void,
  ) {
    this.unsubscribe = [
      EventsOn('term:data', (ev: TermData) => this.handleData(ev)),
      EventsOn('term:exit', (ev: TermExit) => this.handleExit(ev)),
    ];
    this.resizeObserver = new ResizeObserver(() => this.fitActive());
    this.resizeObserver.observe(body);
  }

  async open(kind: TerminalKind, workspaceId: string): Promise<void> {
    if (this.opening) return; // ignore double clicks while a process starts
    this.opening = true;
    const pane = document.createElement('div');
    pane.className = 'term-pane';
    let term: Terminal | undefined;
    try {
      this.body.append(pane);
      term = new Terminal({
        theme: THEME,
        fontFamily: "'Cascadia Mono', Consolas, monospace",
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(pane);
      fit.fit();

      const openFn = kind === 'claude' ? OpenClaude : OpenShell;
      const info = await openFn(workspaceId, term.cols, term.rows);
      this.register({ id: info.id, term, fit, tab: this.createTab(info.id, info.title, info.dir, kind), pane, alive: true });
    } catch (err) {
      term?.dispose();
      pane.remove();
      this.onError(String(err));
    } finally {
      this.opening = false;
    }
  }

  private createTab(id: string, title: string, dir: string, kind: TerminalKind): HTMLElement {
    const tab = document.createElement('div');
    tab.className = `term-tab kind-${kind}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'term-tab-label';
    select.textContent = title;
    select.title = dir;
    select.addEventListener('click', () => this.activate(id));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'term-tab-close';
    close.textContent = '×';
    close.setAttribute('aria-label', `${title} 탭 닫기`);
    close.addEventListener('click', () => void this.close(id));

    tab.append(select, close);
    this.tabs.append(tab);
    return tab;
  }

  private register(session: Session) {
    this.sessions.set(session.id, session);
    session.term.onData((data) => {
      if (session.alive) TermWrite(session.id, data).catch((err) => this.onError(String(err)));
    });
    const { chunks, exit } = this.early.take(session.id);
    for (const chunk of chunks) session.term.write(chunk);
    if (exit) this.markExited(session, exit);
    this.activate(session.id);
  }

  private handleData(ev: TermData) {
    const bytes = base64ToBytes(ev.data);
    const session = this.sessions.get(ev.id);
    if (session) session.term.write(bytes);
    else this.early.data(ev.id, bytes);
  }

  private handleExit(ev: TermExit) {
    const session = this.sessions.get(ev.id);
    if (session) this.markExited(session, ev);
    else this.early.exit(ev.id, ev);
  }

  private markExited(session: Session, ev: TermExit) {
    session.alive = false;
    session.tab.classList.add('exited');
    const reason = ev.error ? `: ${stripControl(ev.error)}` : '';
    session.term.write(`\r\n\x1b[90m[프로세스 종료${reason}]\x1b[0m\r\n`);
  }

  private activate(id: string) {
    this.active = id;
    for (const s of this.sessions.values()) {
      const on = s.id === id;
      s.pane.classList.toggle('active', on);
      s.tab.classList.toggle('active', on);
      s.tab.setAttribute('aria-selected', String(on));
    }
    this.fitActive();
    this.sessions.get(id)?.term.focus();
  }

  private fitActive() {
    const s = this.active ? this.sessions.get(this.active) : undefined;
    if (!s || s.pane.clientWidth === 0) return;
    const { cols, rows } = s.term;
    s.fit.fit();
    if (s.alive && (s.term.cols !== cols || s.term.rows !== rows)) {
      TermResize(s.id, s.term.cols, s.term.rows).catch(() => {
        // The process may have just exited; the exit event will update the tab.
      });
    }
  }

  async close(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    if (s.alive) {
      try {
        await TermClose(id);
      } catch {
        // Already gone.
      }
    }
    s.term.dispose();
    s.pane.remove();
    s.tab.remove();
    if (this.active === id) {
      const next = [...this.sessions.keys()].at(-1);
      this.active = null;
      if (next) this.activate(next);
    }
  }

  /** Releases listeners and terminals (used by Vite HMR). Processes keep running. */
  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.resizeObserver.disconnect();
    for (const s of this.sessions.values()) s.term.dispose();
    this.sessions.clear();
  }
}
