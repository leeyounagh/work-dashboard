package launch

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestLoadSettings(t *testing.T) {
	tests := []struct {
		name    string
		content string // "" = no file
		want    Settings
		wantErr bool
	}{
		{name: "missing file", want: Settings{}},
		{name: "bypass", content: `{"claudePermissionMode":"bypassPermissions"}`, want: Settings{ClaudePermissionMode: "bypassPermissions"}},
		{name: "no mode", content: `{}`, want: Settings{}},
		{name: "unknown mode", content: `{"claudePermissionMode":"yolo"}`, wantErr: true},
		{name: "broken json", content: `{`, wantErr: true},
		{name: "utf-8 bom", content: "ï»¿" + `{"claudePermissionMode":"plan"}`, want: Settings{ClaudePermissionMode: "plan"}},
		{name: "misspelled key", content: `{"claudePermisionMode":"bypassPermissions"}`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "settings.json")
			if tt.content != "" {
				if err := os.WriteFile(path, []byte(tt.content), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			got, err := LoadSettings(path)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && got != tt.want {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			if tt.wantErr && got != (Settings{}) {
				t.Fatalf("a bad file must leave the defaults, got %+v", got)
			}
		})
	}
}

func TestLoadSettingsUnreadable(t *testing.T) {
	if got, err := LoadSettings(t.TempDir()); err == nil || got != (Settings{}) {
		t.Fatalf("a directory: got %+v, err %v", got, err)
	}
}

func TestClaudeSpecPermissionModeAfterMCPConfig(t *testing.T) {
	spec, err := ClaudeSpec(ws(t, t.TempDir()), ClaudeOptions{Exe: "claude", MCPConfigFile: "m.json", PermissionMode: "plan"})
	if err != nil {
		t.Fatal(err)
	}
	// --mcp-config takes several values; the next flag ends them.
	want := []string{"--mcp-config", "m.json", "--permission-mode", "plan"}
	if !slices.Equal(spec.Args, want) {
		t.Fatalf("Args = %q, want %q", spec.Args, want)
	}
}

func TestClaudeSpecPermissionMode(t *testing.T) {
	spec, err := ClaudeSpec(ws(t, t.TempDir()), ClaudeOptions{Exe: "claude", PermissionMode: "bypassPermissions", Prompt: "hi"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"--permission-mode", "bypassPermissions", "--", "hi"}
	if !slices.Equal(spec.Args, want) {
		t.Fatalf("Args = %q, want %q", spec.Args, want)
	}
	if _, err := ClaudeSpec(ws(t, t.TempDir()), ClaudeOptions{Exe: "claude", PermissionMode: "yolo"}); err == nil {
		t.Fatal("an unknown mode must be refused")
	}
}
