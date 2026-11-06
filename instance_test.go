package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestInstanceID(t *testing.T) {
	base := instanceID(false, "")
	if base != "work-dashboard.leeyounagh.github.io" || instanceID(true, "") == base {
		t.Fatalf("base ids: %q, dev %q", base, instanceID(true, ""))
	}
	dir := filepath.Join(t.TempDir(), "Demo")
	a := instanceID(false, dir)
	// The same folder spelled with another case or a trailing separator.
	same := strings.ToLower(dir) + string(filepath.Separator)
	if a == base || a != instanceID(false, same) {
		t.Fatalf("another data folder: %q, same folder spelled differently: %q", a, instanceID(false, same))
	}
	if a == instanceID(false, filepath.Join(filepath.Dir(dir), "other")) {
		t.Fatal("two data folders share an instance")
	}
}
