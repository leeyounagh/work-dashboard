// Package bridge is the local HTTP endpoint Claude Code sessions started by
// the dashboard talk back to: hook events (POST /hook/<session>) and a small
// MCP server with an open_files tool (POST /mcp/<session>).
//
// It listens on 127.0.0.1 only and requires a per-run bearer token. Requests
// carrying an Origin header (browsers) or an unexpected Host (DNS rebinding)
// are refused, so web pages cannot reach it.
package bridge

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const maxBody = 1 << 20 // 1 MiB

var sessionPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// HookEvent is the subset of a Claude Code hook payload the dashboard uses.
type HookEvent struct {
	Session   string         `json:"-"` // from the URL: the dashboard's session key
	Event     string         `json:"hook_event_name"`
	SessionID string         `json:"session_id"`
	Cwd       string         `json:"cwd"`
	ToolName  string         `json:"tool_name"`
	ToolInput map[string]any `json:"tool_input"`
	Message   string         `json:"message"` // Notification
}

// FilePath returns the file a tool call touched, if any.
func (e HookEvent) FilePath() string {
	for _, key := range []string{"file_path", "notebook_path"} {
		if s, ok := e.ToolInput[key].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// Handlers are called for authenticated requests. They run on the HTTP
// goroutine and must return quickly because Claude waits for hooks.
type Handlers struct {
	OnHook func(session string, ev HookEvent)
	// OnOpenFiles opens paths in the dashboard and returns the ones it opened.
	OnOpenFiles func(session string, paths []string) ([]string, error)
}

// Server is a running bridge.
type Server struct {
	h     Handlers
	token string
	addr  string
	srv   *http.Server
}

// Start listens on a random localhost port.
func Start(h Handlers) (*Server, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		_ = ln.Close()
		return nil, fmt.Errorf("generate token: %w", err)
	}
	s := &Server{h: h, token: hex.EncodeToString(buf), addr: ln.Addr().String()}
	s.srv = &http.Server{Handler: s, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = s.srv.Serve(ln) }()
	return s, nil
}

// URL is the base URL, e.g. http://127.0.0.1:51234.
func (s *Server) URL() string { return "http://" + s.addr }

// Token is the bearer token clients must send.
func (s *Server) Token() string { return s.token }

// Close stops the server.
func (s *Server) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = s.srv.Shutdown(ctx)
}

func (s *Server) allowed(r *http.Request) int {
	if r.Header.Get("Origin") != "" {
		return http.StatusForbidden
	}
	_, port, _ := net.SplitHostPort(s.addr)
	if r.Host != s.addr && r.Host != "localhost:"+port {
		return http.StatusForbidden
	}
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
		return http.StatusUnauthorized
	}
	return 0
}

// ServeHTTP routes /hook/<session> and /mcp/<session>.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if code := s.allowed(r); code != 0 {
		http.Error(w, http.StatusText(code), code)
		return
	}
	kind, session, ok := strings.Cut(strings.TrimPrefix(r.URL.Path, "/"), "/")
	if !ok || !sessionPattern.MatchString(session) || (kind != "hook" && kind != "mcp") {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		// The MCP server answers with plain JSON and offers no SSE stream.
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	if kind == "hook" {
		s.serveHook(w, r, session)
		return
	}
	s.serveMCP(w, r, session)
}

func (s *Server) serveHook(w http.ResponseWriter, r *http.Request, session string) {
	var ev HookEvent
	if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if s.h.OnHook != nil {
		s.h.OnHook(session, ev)
	}
	// An empty object means "no decision": Claude carries on as usual.
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte("{}"))
}

// ClaudeConfig returns the --mcp-config and --settings JSON that connect a
// Claude session to this bridge.
func (s *Server) ClaudeConfig(session string) (mcpConfig, settings []byte) {
	headers := map[string]string{"Authorization": "Bearer " + s.token}
	mcpConfig, _ = json.Marshal(map[string]any{
		"mcpServers": map[string]any{
			"work-dashboard": map[string]any{
				"type":    "http",
				"url":     s.URL() + "/mcp/" + session,
				"headers": headers,
			},
		},
	})
	hook := []map[string]any{{"hooks": []map[string]any{{
		"type":    "http",
		"url":     s.URL() + "/hook/" + session,
		"headers": headers,
		"timeout": 3,
	}}}}
	hooks := map[string]any{}
	for _, ev := range []string{"SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SessionEnd"} {
		hooks[ev] = hook
	}
	settings, _ = json.Marshal(map[string]any{"hooks": hooks})
	return mcpConfig, settings
}
