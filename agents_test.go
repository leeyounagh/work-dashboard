package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/bridge"
	"github.com/leeyounagh/work-dashboard/internal/term"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

func waitEvents(t *testing.T, h *harness, name string, n int) []any {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if got := h.eventsNamed(name); len(got) >= n {
			return got
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("expected %d %s events, got %d", n, name, len(h.eventsNamed(name)))
	return nil
}

func openTestClaude(t *testing.T, h *harness) (workspace.Workspace, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ws, err := h.app.SaveWorkspace(workspace.Workspace{Name: "agent", Folders: []string{dir}})
	if err != nil {
		t.Fatal(err)
	}
	info, err := h.app.OpenClaude(ws.ID, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	return ws, info.ID
}

func TestOpenClaudeConnectsBridge(t *testing.T) {
	h := newHarness(t)
	_, termID := openTestClaude(t, h)

	args := h.specs[0].Args
	i := slices.Index(args, "--mcp-config")
	j := slices.Index(args, "--settings")
	if i < 0 || j < 0 {
		t.Fatalf("args = %q", args)
	}
	mcpFile, settingsFile := args[i+1], args[j+1]
	data, err := os.ReadFile(mcpFile)
	if err != nil || !strings.Contains(string(data), "sess-1") {
		t.Fatalf("mcp config = %q, %v", data, err)
	}

	if err := h.app.TermClose(termID); err != nil {
		t.Fatal(err)
	}
	waitEvents(t, h, eventTermExit, 1)
	for _, f := range []string{mcpFile, settingsFile} {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Errorf("%s left behind after the session ended", f)
		}
	}
}

func TestHookBecomesEvents(t *testing.T) {
	h := newHarness(t)
	_, termID := openTestClaude(t, h)

	h.app.onHook("sess-1", bridge.HookEvent{
		Event: "PostToolUse", ToolName: "Edit", ToolInput: map[string]any{"file_path": `C:\w\a.go`},
	})
	ev := waitEvents(t, h, eventAgent, 1)[0].(AgentEvent)
	if ev.TermID != termID || ev.Tool != "Edit" || ev.File != `C:\w\a.go` {
		t.Fatalf("agent event = %+v", ev)
	}
	seen := waitEvents(t, h, eventFilesSeen, 1)[0].(FilesEvent)
	if seen.TermID != termID || seen.Paths[0] != `C:\w\a.go` || seen.Tool != "Edit" {
		t.Fatalf("files:seen = %+v", seen)
	}

	// Unknown sessions are ignored.
	h.app.onHook("other", bridge.HookEvent{Event: "Stop"})
	if n := len(h.eventsNamed(eventAgent)); n != 1 {
		t.Fatalf("unknown session produced events: %d", n)
	}
}

func TestOpenFilesTool(t *testing.T) {
	h := newHarness(t)
	ws, termID := openTestClaude(t, h)

	opened, err := h.app.onOpenFiles("sess-1", []string{"main.go", `C:\Windows\win.ini`})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(opened[0], "main.go") || !strings.Contains(opened[1], "skipped") {
		t.Fatalf("opened = %q", opened)
	}
	ev := waitEvents(t, h, eventFilesOpen, 1)[0].(FilesEvent)
	if ev.TermID != termID || ev.WorkspaceID != ws.ID || len(ev.Paths) != 1 {
		t.Fatalf("files:open = %+v", ev)
	}

	if _, err := h.app.onOpenFiles("sess-1", []string{`C:\Windows\win.ini`}); err == nil {
		t.Fatal("only-outside paths must fail")
	}
	if _, err := h.app.onOpenFiles("nope", []string{"main.go"}); err == nil {
		t.Fatal("unknown session must fail")
	}
}

func TestFileAPIIsGuarded(t *testing.T) {
	h := newHarness(t)
	ws, _ := openTestClaude(t, h)
	root := ws.Folders[0]

	entries, err := h.app.ListDir(root)
	if err != nil || len(entries) != 1 || entries[0].Name != "main.go" {
		t.Fatalf("ListDir = %+v, %v", entries, err)
	}
	c, err := h.app.ReadFile(filepath.Join(root, "main.go"))
	if err != nil || c.Text != "package main\n" {
		t.Fatalf("ReadFile = %+v, %v", c, err)
	}
	outside := t.TempDir()
	if _, err := h.app.ListDir(outside); err == nil {
		t.Fatal("ListDir outside workspaces must fail")
	}
	if _, err := h.app.ReadFile(filepath.Join(outside, "x")); err == nil {
		t.Fatal("ReadFile outside workspaces must fail")
	}
	if _, err := h.app.FileDiff(filepath.Join(outside, "x")); err == nil {
		t.Fatal("FileDiff outside workspaces must fail")
	}
}

func TestCleanRunDir(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"a.mcp.json", "a.settings.json", "keep.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := cleanRunDir(dir); err != nil {
		t.Fatal(err)
	}
	left, _ := filepath.Glob(filepath.Join(dir, "*"))
	if len(left) != 1 || filepath.Base(left[0]) != "keep.txt" {
		t.Fatalf("left = %v", left)
	}
	if err := cleanRunDir(filepath.Join(dir, "missing")); err != nil {
		t.Fatalf("missing dir: %v", err)
	}
}

// A Claude process that dies at once (bad flag, no auth) must not leave its
// token files behind even if it exits before the terminal is bound.
func TestImmediateExitCleansRunFiles(t *testing.T) {
	h := newHarnessWith(t, func() term.Process {
		p := &fakeProc{out: make(chan []byte), closed: make(chan struct{})}
		_ = p.Close() // already exited
		return p
	})
	dir := t.TempDir()
	ws, err := h.app.SaveWorkspace(workspace.Workspace{Name: "dies", Folders: []string{dir}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.app.OpenClaude(ws.ID, 80, 24); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		left, _ := filepath.Glob(filepath.Join(h.app.deps.RunDir, "*.json"))
		if len(left) == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	left, _ := filepath.Glob(filepath.Join(h.app.deps.RunDir, "*.json"))
	t.Fatalf("run files left: %v", left)
}

func TestRegistryRefusesLiveKey(t *testing.T) {
	r := newAgentRegistry()
	if err := r.add("k", &agentSession{workspaceID: "a"}); err != nil {
		t.Fatal(err)
	}
	if err := r.add("k", &agentSession{workspaceID: "b"}); err == nil {
		t.Fatal("a live key must not be reused")
	}
	if s, _ := r.get("k"); s.workspaceID != "a" {
		t.Fatalf("existing session was replaced: %+v", s)
	}
}
