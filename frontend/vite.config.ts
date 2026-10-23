import { defineConfig, type Plugin } from 'vite';

// The production CSP only allows 'self'. Vite's dev server needs a websocket
// for hot reload, so allow localhost websockets while serving only.
function devCsp(): Plugin {
  return {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace("connect-src 'self'", "connect-src 'self' ws://localhost:*"),
  };
}

export default defineConfig({
  plugins: [devCsp()],
});
