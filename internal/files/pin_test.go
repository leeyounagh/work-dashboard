package files

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPinnedFilesOpenOnlyThemselves(t *testing.T) {
	dir := t.TempDir()
	notes := filepath.Join(dir, "notes.md")
	secret := filepath.Join(dir, "secret.txt")
	for _, p := range []string{notes, secret} {
		if err := os.WriteFile(p, []byte(filepath.Base(p)), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := PinFile(dir); err == nil {
		t.Fatal("a folder must not be pinned")
	}
	if _, err := PinFile("notes.md"); err == nil {
		t.Fatal("a relative path must not be pinned")
	}
	pin, err := PinFile(notes)
	if err != nil {
		t.Fatal(err)
	}
	g := NewGuard(nil).WithPins([]Pin{pin})
	if c, err := ReadFile(g, notes, 100); err != nil || c.Text != "notes.md" {
		t.Fatalf("pinned file = %+v, %v", c, err)
	}
	for _, p := range []string{secret, filepath.Join(notes, "..", "secret.txt"), filepath.Join(notes, "x")} {
		if _, err := ReadFile(g, p, 100); err == nil {
			t.Fatalf("%s must not open", p)
		}
	}
	if _, err := ListDir(g, dir); err == nil {
		t.Fatal("the folder of a pinned file must not list")
	}

	// Swapped for a link to another file after pinning: refused.
	if err := os.Remove(notes); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, notes); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := ReadFile(g, notes, 100); err == nil {
		t.Fatal("a pinned path swapped for a link must not open its target")
	}
}
