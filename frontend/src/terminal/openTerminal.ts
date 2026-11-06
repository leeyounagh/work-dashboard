/** Creates a terminal in its pane, with the input fixes every terminal needs. */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { bridgeHangulInput } from './hangulInput';
import { fixComposition } from './imeFix';

export function openTerminal(pane: HTMLElement, options: ITerminalOptions, mac: boolean): { term: Terminal; fit: FitAddon } {
  const term = new Terminal(options);
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(pane);
  // xterm 5.5 garbles IME input on a busy page (see imeFix.ts).
  if (!fixComposition(term)) console.warn('xterm internals changed: the IME input fix (imeFix.ts) is not applied');
  // macOS WebKit gets no composition events from the Korean IME (see hangulInput.ts).
  if (mac) bridgeHangulInput(pane, (data) => term.input(data, true));
  return { term, fit };
}
