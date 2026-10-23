package gitinfo

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseWorktrees(t *testing.T) {
	out := "worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n\n" +
		"worktree C:/repo/.worktrees/feat\nHEAD def\nbranch refs/heads/feature/x\n\n" +
		"worktree C:/repo/.worktrees/det\nHEAD 123\ndetached\n\n" +
		"worktree C:/bare.git\nbare\n"
	got := ParseWorktrees(out)
	if len(got) != 3 {
		t.Fatalf("got %d worktrees: %+v", len(got), got)
	}
	if got[1].Branch != "feature/x" || got[1].Head != "def" || got[1].Path != filepath.FromSlash("C:/repo/.worktrees/feat") {
		t.Fatalf("feat = %+v", got[1])
	}
	if !got[2].Detached || got[2].Branch != "" {
		t.Fatalf("detached = %+v", got[2])
	}
}

func TestParseLeftRight(t *testing.T) {
	l, r, err := ParseLeftRight("3\t12\n")
	if err != nil || l != 3 || r != 12 {
		t.Fatalf("= %d %d %v", l, r, err)
	}
	for _, bad := range []string{"", "1", "a\t2", "1\tb"} {
		if _, _, err := ParseLeftRight(bad); err == nil {
			t.Errorf("%q should fail", bad)
		}
	}
}

func run(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func TestWorktreesAgainstRealRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	repo := t.TempDir()
	run(t, repo, "init", "-q", "-b", "main")
	write := func(name string) {
		if err := os.WriteFile(filepath.Join(repo, name), []byte(name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("a.txt")
	run(t, repo, "add", ".")
	run(t, repo, "commit", "-q", "-m", "a")
	wt := filepath.Join(t.TempDir(), "feat")
	run(t, repo, "worktree", "add", "-q", "-b", "feat", wt)
	// main moves ahead by 2; feat gets 1 commit and an uncommitted file.
	write("b.txt")
	run(t, repo, "add", ".")
	run(t, repo, "commit", "-q", "-m", "b")
	write("c.txt")
	run(t, repo, "add", ".")
	run(t, repo, "commit", "-q", "-m", "c")
	if err := os.WriteFile(filepath.Join(wt, "f.txt"), []byte("f"), 0o600); err != nil {
		t.Fatal(err)
	}
	run(t, wt, "add", ".")
	run(t, wt, "commit", "-q", "-m", "f")
	if err := os.WriteFile(filepath.Join(wt, "dirty.txt"), []byte("d"), 0o600); err != nil {
		t.Fatal(err)
	}

	list, err := Worktrees(context.Background(), repo, "main")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("list = %+v", list)
	}
	feat := list[1]
	if feat.Branch != "feat" || feat.Ahead != 1 || feat.Behind != 2 || feat.Dirty != 1 || feat.Error != "" {
		t.Fatalf("feat = %+v", feat)
	}

	// A missing base ref is reported per worktree, not as a failure of the list.
	list, err = Worktrees(context.Background(), repo, "origin/nope")
	if err != nil || list[0].Error == "" {
		t.Fatalf("missing ref: %+v, %v", list, err)
	}
}

func TestWorktreesRejectsBadInput(t *testing.T) {
	for _, ref := range []string{"--output=x", "a..b", "", "a b"} {
		if _, err := Worktrees(context.Background(), t.TempDir(), ref); err == nil {
			t.Errorf("ref %q should be rejected", ref)
		}
	}
	if _, err := Worktrees(context.Background(), t.TempDir(), "main"); err == nil || !strings.Contains(err.Error(), "git") {
		t.Fatalf("non-repo err = %v", err)
	}
}
