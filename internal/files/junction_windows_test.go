//go:build windows

package files

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func junction(t *testing.T, link, target string) {
	t.Helper()
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
		t.Skipf("mklink /J failed: %v %s", err, out)
	}
}

// A junction inside a workspace must not expose the folder it points to.
func TestJunctionEscapeIsRefused(t *testing.T) {
	root, outside := setup(t)
	link := filepath.Join(root, "jx")
	junction(t, link, outside)
	g := NewGuard([]string{root})

	if _, err := ListDir(g, link); !errors.Is(err, ErrOutside) {
		t.Fatalf("ListDir through junction err = %v, want ErrOutside", err)
	}
	if _, err := ReadFile(g, filepath.Join(link, "secret.txt"), 1024); !errors.Is(err, ErrOutside) {
		t.Fatalf("ReadFile through junction err = %v, want ErrOutside", err)
	}
}

// Junctions that stay inside the workspace (pnpm node_modules) still work.
func TestJunctionInsideWorkspaceWorks(t *testing.T) {
	root, _ := setup(t)
	link := filepath.Join(root, "linked-src")
	junction(t, link, filepath.Join(root, "src"))
	g := NewGuard([]string{root})

	c, err := ReadFile(g, filepath.Join(link, "main.go"), 1024)
	if err != nil || c.Text != "package main\n" {
		t.Fatalf("ReadFile via inner junction = %+v, %v", c, err)
	}
}

// A workspace folder that is itself a junction is usable.
func TestJunctionAsRoot(t *testing.T) {
	root, _ := setup(t)
	link := filepath.Join(t.TempDir(), "ws-link")
	junction(t, link, root)
	g := NewGuard([]string{link})

	entries, err := ListDir(g, link)
	if err != nil || len(entries) == 0 {
		t.Fatalf("ListDir(junction root) = %v, %v", entries, err)
	}
	if _, err := ReadFile(g, filepath.Join(link, "README.md"), 1024); err != nil {
		t.Fatalf("ReadFile under junction root: %v", err)
	}
	_ = os.Remove(link)
}
