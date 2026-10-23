package command

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
)

func TestSplit(t *testing.T) {
	tests := []struct {
		in   string
		want []string
	}{
		{`node "C:\Users\me\skills\deploy status\index.mjs" --json`, []string{"node", `C:\Users\me\skills\deploy status\index.mjs`, "--json"}},
		{`  a   b  `, []string{"a", "b"}},
		{`echo "" x`, []string{"echo", "", "x"}},
		{`a | b > c`, []string{"a", "|", "b", ">", "c"}}, // no shell: plain arguments
	}
	for _, tt := range tests {
		got, err := Split(tt.in)
		if err != nil || !slices.Equal(got, tt.want) {
			t.Errorf("Split(%q) = %q, %v; want %q", tt.in, got, err, tt.want)
		}
	}
	for _, bad := range []string{"", "   ", `a "b`} {
		if _, err := Split(bad); err == nil {
			t.Errorf("Split(%q) should fail", bad)
		}
	}
}

func TestRun(t *testing.T) {
	ok, fail := `cmd /c echo hello`, `cmd /c exit 3`
	if runtime.GOOS != "windows" {
		ok, fail = `sh -c "echo hello"`, `sh -c "exit 3"`
	}
	out, err := Run(context.Background(), t.TempDir(), ok)
	if err != nil || !strings.Contains(out.Stdout, "hello") || out.ExitCode != 0 {
		t.Fatalf("Run ok = %+v, %v", out, err)
	}
	out, err = Run(context.Background(), t.TempDir(), fail)
	if err != nil || out.ExitCode != 3 {
		t.Fatalf("Run fail = %+v, %v", out, err)
	}
	if _, err := Run(context.Background(), t.TempDir(), "definitely-missing-cmd-xyz"); err == nil {
		t.Fatal("missing command must error")
	}
}

func TestRunRefusesBatchFiles(t *testing.T) {
	// Go passes .cmd/.bat arguments through cmd.exe parsing (BatBadBut), so
	// "no shell" would not hold for them.
	for _, line := range []string{`npx.cmd deploy`, `C:\tools\status.BAT --json`} {
		if _, err := Run(context.Background(), t.TempDir(), line); err == nil || !strings.Contains(err.Error(), ".cmd") {
			t.Errorf("Run(%q) err = %v", line, err)
		}
	}
}

func TestCappedOutput(t *testing.T) {
	var c capped
	big := make([]byte, maxOutput+10)
	if n, _ := c.Write(big); n != len(big) || c.buf.Len() != maxOutput || !c.truncated {
		t.Fatalf("n=%d len=%d truncated=%v", n, c.buf.Len(), c.truncated)
	}
	if n, _ := c.Write([]byte("more")); n != 4 || c.buf.Len() != maxOutput {
		t.Fatal("writes past the cap must be dropped but reported as written")
	}
}

func TestRunRefusesRelativeBatchFiles(t *testing.T) {
	// exec resolves scripts\run against the working folder at start, where
	// scripts\run.cmd would be picked up through PATHEXT.
	if runtime.GOOS != "windows" {
		t.Skip("PATHEXT lookup is Windows only")
	}
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "scripts"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "scripts", "run.cmd"), []byte("@echo ran"), 0o700); err != nil {
		t.Fatal(err)
	}
	for _, line := range []string{
		`scripts\run`, `scripts/run`, `.\scripts\run.cmd`,
		// Windows drops trailing dots and spaces, and ::$DATA names the file itself.
		`.\scripts\run.cmd.`, `".\scripts\run.cmd "`, `scripts\run.cmd::$DATA`,
	} {
		if _, err := Run(context.Background(), dir, line); err == nil || !strings.Contains(err.Error(), ".cmd") {
			t.Errorf("Run(%q) err = %v", line, err)
		}
	}
}
