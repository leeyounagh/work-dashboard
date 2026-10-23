//go:build windows

package launch

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/term"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

// TestBatchShimRunsInPTY runs a .cmd shim (like npm's claude.cmd) through the
// real ConPTY and checks that arguments with spaces arrive intact.
func TestBatchShimRunsInPTY(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a real process")
	}
	bin := filepath.Join(t.TempDir(), "bin dir")
	if err := os.MkdirAll(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	shim := filepath.Join(bin, "fake-claude.cmd")
	if err := os.WriteFile(shim, []byte("@echo off\r\necho ARGS[%~1][%~2]\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	first, second := t.TempDir(), filepath.Join(t.TempDir(), "with space")
	if err := os.MkdirAll(second, 0o700); err != nil {
		t.Fatal(err)
	}
	spec, err := ClaudeSpec(workspace.Workspace{ID: "x", Name: "x", Folders: []string{first, second}}, ClaudeOptions{Exe: shim})
	if err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	var out strings.Builder
	exited := make(chan struct{})
	m := term.NewManager(term.StartPTY, func(_ string, b []byte) {
		mu.Lock()
		defer mu.Unlock()
		out.Write(b)
	}, func(string, error) { close(exited) })
	t.Cleanup(m.CloseAll)
	if _, err := m.Open(spec, 200, 24); err != nil {
		t.Fatal(err)
	}
	select {
	case <-exited:
	case <-time.After(10 * time.Second):
		t.Fatal("shim did not exit")
	}
	mu.Lock()
	defer mu.Unlock()
	// ConPTY may wrap or insert escape codes; compare without them.
	got := strings.NewReplacer("\r", "", "\n", "").Replace(out.String())
	if want := "ARGS[--add-dir][" + second + "]"; !strings.Contains(got, want) {
		t.Fatalf("output %q does not contain %q", got, want)
	}
}
