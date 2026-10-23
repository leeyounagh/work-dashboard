package files

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSearch(t *testing.T) {
	root, outside := setup(t)
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.MkdirAll(filepath.Join(root, "node_modules", "pkg"), 0o700))
	must(os.WriteFile(filepath.Join(root, "node_modules", "pkg", "main.go"), []byte("x"), 0o600))
	must(os.WriteFile(filepath.Join(root, "src", "deep", "LeaveForm.tsx"), []byte("x"), 0o600))
	must(os.WriteFile(filepath.Join(outside, "main.go"), []byte("x"), 0o600))

	g := NewGuard([]string{root})
	res, err := Search(context.Background(), g, []string{root}, "main", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Entries) != 1 || res.Entries[0].Path != filepath.Join(root, "src", "main.go") {
		t.Fatalf("entries = %+v (node_modules and other roots must be skipped)", res.Entries)
	}

	// Case-insensitive, matches the whole relative path, files only.
	res, _ = Search(context.Background(), g, []string{root}, "deep/leave", 50)
	if len(res.Entries) != 1 || !strings.HasSuffix(res.Entries[0].Path, "LeaveForm.tsx") {
		t.Fatalf("path search = %+v", res.Entries)
	}

	// Name matches rank before path-only matches.
	res, _ = Search(context.Background(), g, []string{root}, "src", 50)
	if len(res.Entries) == 0 {
		t.Fatal("expected path matches for src")
	}

	res, _ = Search(context.Background(), g, []string{root}, ".", 1)
	if len(res.Entries) != 1 || !res.Truncated {
		t.Fatalf("limit not applied: %+v", res)
	}

	if _, err := Search(context.Background(), g, []string{root}, " ", 50); err == nil {
		t.Fatal("empty query must fail")
	}
	if res, _ := Search(context.Background(), g, []string{outside}, "main", 50); len(res.Entries) != 0 {
		t.Fatal("roots outside the guard must not be searched")
	}
}

func TestSearchStopsOnTimeout(t *testing.T) {
	root, _ := setup(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	time.Sleep(time.Millisecond)
	res, err := Search(ctx, NewGuard([]string{root}), []string{root}, "a", 50)
	if err != nil || !res.Truncated {
		t.Fatalf("res = %+v, err = %v; a timeout returns what was found so far", res, err)
	}
}
