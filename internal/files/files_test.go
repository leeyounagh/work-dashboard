package files

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func setup(t *testing.T) (root, outside string) {
	t.Helper()
	root = t.TempDir()
	outside = t.TempDir()
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.MkdirAll(filepath.Join(root, "src", "deep"), 0o700))
	must(os.MkdirAll(filepath.Join(root, ".git"), 0o700))
	must(os.WriteFile(filepath.Join(root, "README.md"), []byte("# hi\n"), 0o600))
	must(os.WriteFile(filepath.Join(root, "src", "main.go"), []byte("package main\n"), 0o600))
	must(os.WriteFile(filepath.Join(root, "src", "logo.png"), []byte{0x89, 'P', 'N', 'G', 0, 0, 1}, 0o600))
	must(os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o600))
	return root, outside
}

func TestResolve(t *testing.T) {
	root, outside := setup(t)
	g := NewGuard([]string{root})

	got, err := g.Resolve(filepath.Join(root, "src", "main.go"))
	if err != nil || !strings.HasSuffix(got, filepath.Join("src", "main.go")) {
		t.Fatalf("Resolve inside = %q, %v", got, err)
	}
	for _, p := range []string{
		filepath.Join(outside, "secret.txt"),
		filepath.Join(root, "..", filepath.Base(outside), "secret.txt"),
		"relative/path.go",
		root + "-sibling",
	} {
		if _, err := g.Resolve(p); !errors.Is(err, ErrOutside) {
			t.Errorf("Resolve(%q) err = %v, want ErrOutside", p, err)
		}
	}
	if _, err := NewGuard(nil).Resolve(filepath.Join(root, "README.md")); !errors.Is(err, ErrOutside) {
		t.Error("a guard without roots must refuse everything")
	}
}

func TestResolveRejectsSymlinkEscape(t *testing.T) {
	root, outside := setup(t)
	link := filepath.Join(root, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks not available: %v", err)
	}
	if _, err := NewGuard([]string{root}).Resolve(filepath.Join(link, "secret.txt")); !errors.Is(err, ErrOutside) {
		t.Fatalf("symlink escape err = %v, want ErrOutside", err)
	}
}

func TestResolveRelativeTo(t *testing.T) {
	root, _ := setup(t)
	g := NewGuard([]string{root})
	got, err := g.ResolveFrom(root, filepath.Join("src", "main.go"))
	if err != nil || !strings.HasSuffix(got, filepath.Join("src", "main.go")) {
		t.Fatalf("ResolveFrom = %q, %v", got, err)
	}
	if _, err := g.ResolveFrom(root, filepath.Join("..", "x")); !errors.Is(err, ErrOutside) {
		t.Fatalf("ResolveFrom escape err = %v", err)
	}
}

func TestListDir(t *testing.T) {
	root, _ := setup(t)
	entries, err := ListDir(NewGuard([]string{root}), root)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name)
	}
	// Directories first, then files, both sorted; .git is hidden.
	if strings.Join(names, ",") != "src,README.md" {
		t.Fatalf("entries = %v", names)
	}
	if !entries[0].Dir || entries[1].Dir || entries[1].Path != filepath.Join(root, "README.md") {
		t.Fatalf("entries = %+v", entries)
	}
	if _, err := ListDir(NewGuard([]string{root}), t.TempDir()); !errors.Is(err, ErrOutside) {
		t.Fatalf("ListDir outside err = %v", err)
	}
}

func TestReadFile(t *testing.T) {
	root, _ := setup(t)
	g := NewGuard([]string{root})

	fc, err := ReadFile(g, filepath.Join(root, "src", "main.go"), 1024)
	if err != nil || fc.Text != "package main\n" || fc.Binary || fc.Truncated {
		t.Fatalf("text file = %+v, %v", fc, err)
	}

	fc, err = ReadFile(g, filepath.Join(root, "src", "logo.png"), 1024)
	if err != nil || !fc.Binary || fc.Text != "" {
		t.Fatalf("binary file = %+v, %v", fc, err)
	}

	fc, err = ReadFile(g, filepath.Join(root, "README.md"), 3)
	if err != nil || !fc.Truncated || fc.Text != "# h" || fc.Size != 5 {
		t.Fatalf("truncated file = %+v, %v", fc, err)
	}

	if _, err := ReadFile(g, filepath.Join(root, "src"), 1024); err == nil {
		t.Fatal("reading a directory should fail")
	}
}

func TestDiff(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root, _ := setup(t)
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", root, "-c", "user.email=t@t", "-c", "user.name=t"}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	if err := os.RemoveAll(filepath.Join(root, ".git")); err != nil {
		t.Fatal(err)
	}
	git("init", "-q")
	git("add", "README.md")
	git("commit", "-q", "-m", "init")
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	g := NewGuard([]string{root})
	diff, err := Diff(g, filepath.Join(root, "README.md"))
	if err != nil || !strings.Contains(diff, "+# changed") {
		t.Fatalf("Diff = %q, %v", diff, err)
	}
	clean, err := Diff(g, filepath.Join(root, "src", "main.go"))
	if err != nil || clean != "" {
		t.Fatalf("untracked file diff = %q, %v", clean, err)
	}
}
