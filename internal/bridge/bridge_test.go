package bridge

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

type recorder struct {
	mu     sync.Mutex
	hooks  []HookEvent
	opened [][]string
	fail   bool
}

func (r *recorder) handlers() Handlers {
	return Handlers{
		OnHook: func(session string, ev HookEvent) {
			r.mu.Lock()
			defer r.mu.Unlock()
			ev.Session = session
			r.hooks = append(r.hooks, ev)
		},
		OnOpenFiles: func(session string, paths []string) ([]string, error) {
			r.mu.Lock()
			defer r.mu.Unlock()
			if r.fail {
				return nil, errors.New("outside the workspace")
			}
			r.opened = append(r.opened, append([]string{session}, paths...))
			return paths, nil
		},
	}
}

func start(t *testing.T) (*Server, *recorder) {
	t.Helper()
	rec := &recorder{}
	s, err := Start(rec.handlers())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s, rec
}

func post(t *testing.T, s *Server, path, body string, mutate func(*http.Request)) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, s.URL()+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+s.Token())
	req.Header.Set("Content-Type", "application/json")
	if mutate != nil {
		mutate(req)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func TestHookIsDelivered(t *testing.T) {
	s, rec := start(t)
	body := `{"hook_event_name":"PostToolUse","session_id":"abc","tool_name":"Read","tool_input":{"file_path":"C:\\w\\a.go"}}`
	res := post(t, s, "/hook/sess-1", body, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.hooks) != 1 {
		t.Fatalf("hooks = %+v", rec.hooks)
	}
	ev := rec.hooks[0]
	if ev.Session != "sess-1" || ev.Event != "PostToolUse" || ev.ToolName != "Read" || ev.FilePath() != `C:\w\a.go` {
		t.Fatalf("event = %+v", ev)
	}
}

func TestRejectsBadRequests(t *testing.T) {
	s, rec := start(t)
	tests := []struct {
		name   string
		path   string
		mutate func(*http.Request)
		want   int
	}{
		{"no token", "/hook/s", func(r *http.Request) { r.Header.Del("Authorization") }, http.StatusUnauthorized},
		{"wrong token", "/hook/s", func(r *http.Request) { r.Header.Set("Authorization", "Bearer nope") }, http.StatusUnauthorized},
		{"browser origin", "/hook/s", func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }, http.StatusForbidden},
		{"rebinding host", "/hook/s", func(r *http.Request) { r.Host = "evil.example" }, http.StatusForbidden},
		{"bad session", "/hook/a b", nil, http.StatusNotFound},
		{"unknown route", "/other", nil, http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := post(t, s, strings.ReplaceAll(tt.path, " ", "%20"), `{}`, tt.mutate)
			if res.StatusCode != tt.want {
				t.Fatalf("status = %d, want %d", res.StatusCode, tt.want)
			}
		})
	}
	if len(rec.hooks) != 0 {
		t.Fatal("rejected requests must not reach handlers")
	}
}

func TestRejectsLargeBody(t *testing.T) {
	s, _ := start(t)
	res := post(t, s, "/hook/s", `{"x":"`+strings.Repeat("a", maxBody+10)+`"}`, nil)
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d", res.StatusCode)
	}
}

func rpc(t *testing.T, s *Server, body string) map[string]any {
	t.Helper()
	res := post(t, s, "/mcp/sess-1", body, nil)
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("status = %d: %s", res.StatusCode, b)
	}
	var out map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestMCPInitializeAndListTools(t *testing.T) {
	s, _ := start(t)
	init := rpc(t, s, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"claude-code","version":"x"}}}`)
	result := init["result"].(map[string]any)
	if result["protocolVersion"] != "2025-06-18" || result["serverInfo"].(map[string]any)["name"] != "work-dashboard" {
		t.Fatalf("initialize = %v", init)
	}

	res := post(t, s, "/mcp/sess-1", `{"jsonrpc":"2.0","method":"notifications/initialized"}`, nil)
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("notification status = %d", res.StatusCode)
	}

	list := rpc(t, s, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	tools := list["result"].(map[string]any)["tools"].([]any)
	if len(tools) != 1 || tools[0].(map[string]any)["name"] != "open_files" {
		t.Fatalf("tools = %v", tools)
	}
}

func TestMCPOpenFiles(t *testing.T) {
	s, rec := start(t)
	out := rpc(t, s, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"open_files","arguments":{"paths":["a.go","b.go"]}}}`)
	result := out["result"].(map[string]any)
	if result["isError"] == true {
		t.Fatalf("result = %v", result)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "a.go") {
		t.Fatalf("text = %q", text)
	}
	if len(rec.opened) != 1 || rec.opened[0][0] != "sess-1" || rec.opened[0][2] != "b.go" {
		t.Fatalf("opened = %v", rec.opened)
	}

	rec.fail = true
	out = rpc(t, s, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"open_files","arguments":{"paths":["/etc/passwd"]}}}`)
	if out["result"].(map[string]any)["isError"] != true {
		t.Fatalf("handler error should be a tool error: %v", out)
	}
}

func TestMCPErrors(t *testing.T) {
	s, _ := start(t)
	tests := map[string]string{
		"unknown method":  `{"jsonrpc":"2.0","id":5,"method":"resources/list"}`,
		"unknown tool":    `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"rm","arguments":{}}}`,
		"missing paths":   `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"open_files","arguments":{}}}`,
		"too many paths":  `{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"open_files","arguments":{"paths":[` + strings.Repeat(`"a",`, maxOpenFiles) + `"a"]}}}`,
		"not json at all": `nope`,
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			res := post(t, s, "/mcp/sess-1", body, nil)
			var out map[string]any
			_ = json.NewDecoder(res.Body).Decode(&out)
			if out["error"] == nil && (out["result"] == nil || out["result"].(map[string]any)["isError"] != true) {
				t.Fatalf("expected an error, got %v", out)
			}
		})
	}
}

func TestMCPGetIsNotAllowed(t *testing.T) {
	s, _ := start(t)
	req, _ := http.NewRequest(http.MethodGet, s.URL()+"/mcp/sess-1", nil)
	req.Header.Set("Authorization", "Bearer "+s.Token())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", res.StatusCode)
	}
}

func TestClaudeFiles(t *testing.T) {
	s, _ := start(t)
	mcp, settings := s.ClaudeConfig("sess-9")
	var m map[string]map[string]map[string]any
	if err := json.Unmarshal(mcp, &m); err != nil {
		t.Fatal(err)
	}
	srv := m["mcpServers"]["work-dashboard"]
	if srv["type"] != "http" || srv["url"] != s.URL()+"/mcp/sess-9" {
		t.Fatalf("mcp config = %s", mcp)
	}
	if !bytes.Contains(settings, []byte(s.URL()+"/hook/sess-9")) || !bytes.Contains(settings, []byte("Bearer "+s.Token())) {
		t.Fatalf("settings = %s", settings)
	}
	for _, ev := range []string{"PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "Notification"} {
		if !bytes.Contains(settings, []byte(`"`+ev+`"`)) {
			t.Errorf("settings missing %s hook", ev)
		}
	}
}
