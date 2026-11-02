package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestSeenFilesBoundedAndDeduped(t *testing.T) {
	var s seenFiles
	dir := t.TempDir()
	path := func(i int) string { return filepath.Join(dir, fmt.Sprintf("f%d.txt", i)) }
	for i := 0; i <= maxSeenFiles; i++ {
		if err := os.WriteFile(path(i), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	s.add(path(0))
	s.add(path(0))
	s.add(dir)            // a folder
	s.add("relative.txt") // not absolute
	s.add(filepath.Join(dir, "missing.txt"))
	if got := s.pins(); len(got) != 1 || got[0].Path != path(0) {
		t.Fatalf("pins = %+v", got)
	}
	for i := 1; i <= maxSeenFiles; i++ {
		s.add(path(i))
	}
	got := s.pins()
	if len(got) != maxSeenFiles || got[0].Path != path(1) {
		t.Fatalf("len = %d, oldest = %s", len(got), got[0].Path)
	}
}
