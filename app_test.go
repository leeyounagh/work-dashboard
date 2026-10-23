package main

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/term"
	"github.com/leeyounagh/work-dashboard/internal/widget"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

// fakeProc emits one chunk of output and exits when closed.
type fakeProc struct {
	out    chan []byte
	closed chan struct{}
	once   sync.Once
}

func (p *fakeProc) Read(b []byte) (int, error) {
	select {
	case chunk := <-p.out:
		return copy(b, chunk), nil
	case <-p.closed:
		return 0, io.EOF
	}
}
func (p *fakeProc) Write(b []byte) (int, error) { return len(b), nil }
func (p *fakeProc) Resize(int, int) error       { return nil }
func (p *fakeProc) Close() error                { p.once.Do(func() { close(p.closed) }); return nil }
func (p *fakeProc) Wait() error                 { <-p.closed; return nil }

type fakeBridge struct{}

func (fakeBridge) ClaudeConfig(key string) ([]byte, []byte) {
	return []byte(`{"mcpServers":{"k":"` + key + `"}}`), []byte(`{"hooks":{}}`)
}

type event struct {
	name string
	data any
}

type harness struct {
	app    *App
	store  *workspace.Store
	mu     sync.Mutex
	events []event
	specs  []term.Spec
}

func (h *harness) eventsNamed(name string) []any {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []any
	for _, e := range h.events {
		if e.name == name {
			out = append(out, e.data)
		}
	}
	return out
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	return newHarnessWith(t, nil)
}

// newHarnessWith uses newProc for started processes (nil = one that prints and stays alive).
func newHarnessWith(t *testing.T, newProc func() term.Process) *harness {
	t.Helper()
	h := &harness{store: workspace.NewStore(t.TempDir())}
	h.app = NewApp(Deps{
		Workspaces: h.store,
		Start: func(spec term.Spec, _, _ int) (term.Process, error) {
			h.mu.Lock()
			h.specs = append(h.specs, spec)
			h.mu.Unlock()
			if newProc != nil {
				return newProc(), nil
			}
			p := &fakeProc{out: make(chan []byte, 1), closed: make(chan struct{})}
			p.out <- []byte("héllo")
			return p, nil
		},
		Emit: func(_ context.Context, name string, data any) {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.events = append(h.events, event{name, data})
		},
		FindClaude:   func() (string, error) { return `C:\bin\claude.exe`, nil },
		Shell:        "powershell.exe",
		NotesDir:     t.TempDir(),
		NewSessionID: func() string { return "sess-1" },
		PickFolder:   func(context.Context) (string, error) { return `C:\picked`, nil },
		Bridge:       fakeBridge{},
		RunDir:       t.TempDir(),
	})
	t.Cleanup(func() { h.app.shutdown(context.Background()) })
	return h
}

func TestSaveWorkspaceCreatesWithIDAndDefaultWidgets(t *testing.T) {
	h := newHarness(t)
	saved, err := h.app.SaveWorkspace(workspace.Workspace{Name: "  Front End  ", Folders: []string{t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID != "front-end" || saved.Name != "Front End" {
		t.Fatalf("saved = %+v", saved)
	}
	if len(saved.Widgets) != len(widget.Catalog()) {
		t.Fatalf("new workspace should get every widget, got %d", len(saved.Widgets))
	}
	res := h.app.Workspaces()
	if len(res.Workspaces) != 1 || res.Workspaces[0].ID != "front-end" {
		t.Fatalf("Workspaces() = %+v", res)
	}

	// Saving again with the ID updates instead of creating a second one.
	saved.Notes = "memo"
	if _, err := h.app.SaveWorkspace(saved); err != nil {
		t.Fatal(err)
	}
	if res := h.app.Workspaces(); len(res.Workspaces) != 1 || res.Workspaces[0].Notes != "memo" {
		t.Fatalf("update failed: %+v", res)
	}
}

func TestSaveWorkspaceDefaultsEmptyWidgetListOnCreate(t *testing.T) {
	h := newHarness(t)
	// The UI sends [] rather than null for a new workspace.
	saved, err := h.app.SaveWorkspace(workspace.Workspace{Name: "ui", Widgets: []widget.Instance{}})
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Widgets) != len(widget.Catalog()) {
		t.Fatalf("new workspace got %d widgets, want all", len(saved.Widgets))
	}
	// An existing workspace keeps an empty list: the user switched everything off.
	saved.Widgets = []widget.Instance{}
	updated, err := h.app.SaveWorkspace(saved)
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Widgets) != 0 {
		t.Fatalf("update re-added widgets: %d", len(updated.Widgets))
	}
}

func TestSaveWorkspaceValidationError(t *testing.T) {
	h := newHarness(t)
	_, err := h.app.SaveWorkspace(workspace.Workspace{Name: "x", Folders: []string{"relative"}})
	if err == nil || !strings.Contains(err.Error(), "저장하지 못했습니다") {
		t.Fatalf("err = %v", err)
	}
}

func TestDeleteWorkspace(t *testing.T) {
	h := newHarness(t)
	saved, err := h.app.SaveWorkspace(workspace.Workspace{Name: "gone"})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.app.DeleteWorkspace(saved.ID); err != nil {
		t.Fatal(err)
	}
	if err := h.app.DeleteWorkspace(saved.ID); !errors.Is(err, workspace.ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
}

func TestOpenClaudeBuildsSpecAndStreams(t *testing.T) {
	h := newHarness(t)
	a, b := t.TempDir(), t.TempDir()
	saved, err := h.app.SaveWorkspace(workspace.Workspace{Name: "gw", Folders: []string{a, b}, Notes: "규칙"})
	if err != nil {
		t.Fatal(err)
	}
	info, err := h.app.OpenClaude(saved.ID, 100, 30)
	if err != nil {
		t.Fatal(err)
	}
	if info.Kind != "claude" {
		t.Fatalf("info = %+v", info)
	}
	spec := h.specs[0]
	if spec.Dir != a || !slices.Contains(spec.Args, b) || !slices.Contains(spec.Args, "sess-1") ||
		!slices.Contains(spec.Args, "--append-system-prompt-file") {
		t.Fatalf("spec = %+v", spec)
	}

	deadline := time.Now().Add(2 * time.Second)
	for len(h.eventsNamed(eventTermData)) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	data := h.eventsNamed(eventTermData)
	if len(data) == 0 {
		t.Fatal("no term:data event")
	}
	ev := data[0].(TermData)
	raw, _ := base64.StdEncoding.DecodeString(ev.Data)
	if ev.ID != info.ID || string(raw) != "héllo" {
		t.Fatalf("event = %+v (%q)", ev, raw)
	}

	if len(h.app.Terminals()) != 1 {
		t.Fatal("terminal not listed")
	}
	if err := h.app.TermWrite(info.ID, "x"); err != nil {
		t.Fatal(err)
	}
	if err := h.app.TermResize(info.ID, 90, 20); err != nil {
		t.Fatal(err)
	}
	if err := h.app.TermClose(info.ID); err != nil {
		t.Fatal(err)
	}
	for len(h.eventsNamed(eventTermExit)) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if len(h.eventsNamed(eventTermExit)) != 1 {
		t.Fatal("no term:exit event")
	}
}

func TestOpenClaudeErrors(t *testing.T) {
	h := newHarness(t)
	if _, err := h.app.OpenClaude("missing", 80, 24); err == nil {
		t.Fatal("expected error for unknown workspace")
	}
	saved, err := h.app.SaveWorkspace(workspace.Workspace{Name: "empty"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.app.OpenClaude(saved.ID, 80, 24); err == nil || !strings.Contains(err.Error(), "no folders") {
		t.Fatalf("err = %v, want no-folders error", err)
	}
	h.app.deps.FindClaude = func() (string, error) { return "", errors.New("not found") }
	if _, err := h.app.OpenClaude(saved.ID, 80, 24); err == nil || !strings.Contains(err.Error(), "Claude Code") {
		t.Fatalf("err = %v, want install hint", err)
	}
}

func TestOpenShellWithoutFolders(t *testing.T) {
	h := newHarness(t)
	saved, err := h.app.SaveWorkspace(workspace.Workspace{Name: "empty"})
	if err != nil {
		t.Fatal(err)
	}
	info, err := h.app.OpenShell(saved.ID, 80, 24)
	if err != nil || info.Kind != "shell" {
		t.Fatalf("OpenShell = %+v, %v", info, err)
	}
	if _, err := h.app.OpenShell("missing", 80, 24); err == nil {
		t.Fatal("expected error for unknown workspace")
	}
}

func TestPickFolderAndInfo(t *testing.T) {
	h := newHarness(t)
	if got, err := h.app.PickFolder(); err != nil || got != `C:\picked` {
		t.Fatalf("PickFolder = %q, %v", got, err)
	}
	if h.app.Info().Version == "" || len(h.app.WidgetCatalog()) == 0 {
		t.Fatal("info/catalog empty")
	}
}

func TestDeleteWorkspaceRemovesNotes(t *testing.T) {
	h := newHarness(t)
	saved, err := h.app.SaveWorkspace(workspace.Workspace{Name: "memo", Folders: []string{t.TempDir()}, Notes: "규칙"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.app.OpenClaude(saved.ID, 80, 24); err != nil {
		t.Fatal(err)
	}
	notes := filepath.Join(h.app.deps.NotesDir, saved.ID+".md")
	if _, err := os.Stat(notes); err != nil {
		t.Fatalf("notes file not written: %v", err)
	}
	if err := h.app.DeleteWorkspace(saved.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(notes); !os.IsNotExist(err) {
		t.Fatalf("notes file left after delete: %v", err)
	}
}

func TestSaveWorkspaceCleansFolders(t *testing.T) {
	h := newHarness(t)
	dir := t.TempDir()
	saved, err := h.app.SaveWorkspace(workspace.Workspace{Name: "c", Folders: []string{dir + `\sub\..\`}})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Folders[0] != filepath.Clean(dir) {
		t.Fatalf("folder = %q, want %q", saved.Folders[0], filepath.Clean(dir))
	}
}

func TestTerminalsLockedInDevMode(t *testing.T) {
	h := newHarness(t)
	saved, err := h.app.SaveWorkspace(workspace.Workspace{Name: "dev", Folders: []string{t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	h.app.deps.TerminalsLocked = true
	if _, err := h.app.OpenShell(saved.ID, 80, 24); err == nil || !strings.Contains(err.Error(), "WD_DEV_TERMINALS") {
		t.Fatalf("OpenShell err = %v, want lock message", err)
	}
	if _, err := h.app.OpenClaude(saved.ID, 80, 24); err == nil {
		t.Fatal("OpenClaude must be locked")
	}
	if err := h.app.TermWrite("t1", "x"); err == nil {
		t.Fatal("TermWrite must be locked")
	}
}

func TestOpenClaudeReportsBrokenWorkspaceFile(t *testing.T) {
	h := newHarness(t)
	if _, err := h.app.OpenClaude("missing", 80, 24); err == nil || !strings.Contains(err.Error(), "찾지 못했습니다") {
		t.Fatalf("missing: %v", err)
	}
	if _, err := h.app.OpenClaude("../bad", 80, 24); err == nil || strings.Contains(err.Error(), "찾지 못했습니다") {
		t.Fatalf("invalid id should not be reported as not found: %v", err)
	}
}
