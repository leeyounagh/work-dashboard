package launch

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

func ws(t *testing.T, folders ...string) workspace.Workspace {
	t.Helper()
	return workspace.Workspace{ID: "gw", Name: "그룹웨어", Folders: folders}
}

func TestClaudeSpec(t *testing.T) {
	a, b, c := filepath.Join(t.TempDir(), "fe"), filepath.Join(t.TempDir(), "be"), filepath.Join(t.TempDir(), "wt")
	spec, err := ClaudeSpec(ws(t, a, b, c), ClaudeOptions{
		Exe:       "claude",
		SessionID: "11111111-2222-3333-4444-555555555555",
		NotesFile: `C:\notes\gw.md`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Dir != a {
		t.Errorf("Dir = %q, want first folder", spec.Dir)
	}
	want := []string{
		"--add-dir", b, "--add-dir", c,
		"--session-id", "11111111-2222-3333-4444-555555555555",
		"--append-system-prompt-file", `C:\notes\gw.md`,
	}
	if !slices.Equal(spec.Args, want) {
		t.Errorf("Args = %q\nwant  %q", spec.Args, want)
	}
	if spec.Name != "claude" || !strings.Contains(spec.Title, "그룹웨어") {
		t.Errorf("spec = %+v", spec)
	}
}

func TestClaudeSpecResume(t *testing.T) {
	spec, err := ClaudeSpec(ws(t, t.TempDir()), ClaudeOptions{Exe: "claude", SessionID: "abc", Resume: true})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(spec.Args, []string{"--resume", "abc"}) {
		t.Errorf("Args = %q", spec.Args)
	}
}

func TestClaudeSpecRequiresFolder(t *testing.T) {
	if _, err := ClaudeSpec(ws(t), ClaudeOptions{Exe: "claude"}); err == nil {
		t.Fatal("expected error without folders")
	}
}

func TestShellSpec(t *testing.T) {
	dir := t.TempDir()
	spec, err := ShellSpec(ws(t, dir), "powershell.exe")
	if err != nil {
		t.Fatal(err)
	}
	if spec.Dir != dir || spec.Name != "powershell.exe" || len(spec.Args) != 1 || spec.Args[0] != "-NoLogo" {
		t.Errorf("spec = %+v", spec)
	}
	// A workspace without folders still gets a shell in the home directory.
	spec, err = ShellSpec(ws(t), "powershell.exe")
	if err != nil || spec.Dir == "" {
		t.Errorf("spec = %+v, err = %v", spec, err)
	}
}

func TestWrapBatchFile(t *testing.T) {
	tests := []struct {
		name     string
		exe      string
		args     []string
		wantName string
		wantArgs []string
	}{
		{
			name:     "exe is left alone",
			exe:      `C:\bin\claude.exe`,
			args:     []string{"--add-dir", `C:\a b`},
			wantName: `C:\bin\claude.exe`,
			wantArgs: []string{"--add-dir", `C:\a b`},
		},
		{
			name:     "cmd shim runs through cmd.exe with quoted args",
			exe:      `C:\npm\claude.cmd`,
			args:     []string{"--add-dir", `C:\a b`},
			wantName: "cmd.exe",
			wantArgs: []string{"/d", "/v:off", "/s", "/c", `""C:\npm\claude.cmd" "--add-dir" "C:\a b""`},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			name, args := wrapBatch(tt.exe, tt.args)
			if name != tt.wantName || !slices.Equal(args, tt.wantArgs) {
				t.Errorf("got %q %q\nwant %q %q", name, args, tt.wantName, tt.wantArgs)
			}
		})
	}
}

func TestQuoteForCmd(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{in: `C:\R&D`, want: `"C:\R&D"`}, // harmless inside quotes with /s /c
		{in: `C:\a(b)`, want: `"C:\a(b)"`},
		{in: `C:\My Proj\`, want: `"C:\My Proj\\"`}, // a trailing \ must not escape the closing quote
		{in: ``, want: `""`},
		{in: `C:\100%`, wantErr: true},
		{in: `C:\wow!`, wantErr: true},
		{in: `C:\"x`, wantErr: true},
		{in: "a\nb", wantErr: true},
	}
	for _, tt := range tests {
		got, err := quoteForCmd([]string{tt.in})
		if tt.wantErr {
			if err == nil {
				t.Errorf("quoteForCmd(%q) should fail", tt.in)
			}
			continue
		}
		if err != nil || got != tt.want {
			t.Errorf("quoteForCmd(%q) = %q, %v; want %q", tt.in, got, err, tt.want)
		}
	}
}

func TestWriteNotes(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "notes")
	w := ws(t, t.TempDir())

	path, err := WriteNotes(dir, w)
	if err != nil || path != "" {
		t.Fatalf("empty notes: path=%q err=%v, want no file", path, err)
	}

	w.Notes = "PR 은 test 브랜치로"
	path, err = WriteNotes(dir, w)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), w.Notes) || !strings.Contains(string(data), w.Name) {
		t.Fatalf("notes file = %q", data)
	}
	if filepath.Dir(path) != dir {
		t.Fatalf("path = %q, want inside %q", path, dir)
	}

	// Clearing the notes removes the stale file.
	w.Notes = " "
	if path, err := WriteNotes(dir, w); err != nil || path != "" {
		t.Fatalf("cleared notes: path=%q err=%v", path, err)
	}
	if _, err := os.Stat(filepath.Join(dir, w.ID+".md")); !os.IsNotExist(err) {
		t.Fatalf("stale notes file left behind: %v", err)
	}
	if err := RemoveNotes(dir, w.ID); err != nil {
		t.Fatalf("RemoveNotes on a missing file: %v", err)
	}
}

func TestResolveShim(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("MZ"), 0o700); err != nil {
		t.Fatal(err)
	}
	shim := filepath.Join(dir, "claude.cmd")
	npmShim := "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n" +
		`"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*` + "\r\n"
	if err := os.WriteFile(shim, []byte(npmShim), 0o600); err != nil {
		t.Fatal(err)
	}
	got, ok := resolveShim(shim)
	if !ok || !strings.EqualFold(filepath.Clean(got), target) {
		t.Fatalf("resolveShim = %q, %v; want %q", got, ok, target)
	}

	// The resolved exe is run directly: no cmd.exe, no raw command line.
	spec, err := ClaudeSpec(ws(t, t.TempDir()), ClaudeOptions{Exe: shim})
	if err != nil {
		t.Fatal(err)
	}
	if spec.RawArgs || !strings.EqualFold(filepath.Clean(spec.Name), target) {
		t.Fatalf("spec = %+v, want direct exe", spec)
	}

	// A shim whose target is missing, or an unrelated batch file, is not resolved.
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if _, ok := resolveShim(shim); ok {
		t.Fatal("missing target must not resolve")
	}
	other := filepath.Join(dir, "other.cmd")
	if err := os.WriteFile(other, []byte("@echo hi\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := resolveShim(other); ok {
		t.Fatal("a batch file without an exe line must not resolve")
	}
}
