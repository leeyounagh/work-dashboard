package main

import (
	"errors"
	"testing"
)

func TestShellFor(t *testing.T) {
	look := func(have ...string) func(string) (string, error) {
		return func(name string) (string, error) {
			for _, h := range have {
				if h == name {
					return "/usr/bin/" + name, nil
				}
			}
			return "", errors.New("not found")
		}
	}
	env := func(shell string) func(string) string {
		return func(k string) string {
			if k == "SHELL" {
				return shell
			}
			return ""
		}
	}
	tests := []struct {
		name, goos, shell string
		have              []string
		want              string
	}{
		{"windows with PowerShell 7", "windows", "", []string{"pwsh"}, "pwsh"},
		{"windows", "windows", "", nil, "powershell.exe"},
		{"mac user shell", "darwin", "/bin/zsh", nil, "/bin/zsh"},
		{"linux without SHELL", "linux", "", []string{"bash"}, "/usr/bin/bash"},
		{"relative SHELL ignored", "linux", "zsh", []string{"zsh"}, "/usr/bin/zsh"},
		{"nothing found", "linux", "", nil, "/bin/sh"},
	}
	for _, tt := range tests {
		if got := shellFor(tt.goos, env(tt.shell), look(tt.have...)); got != tt.want {
			t.Errorf("%s: shellFor = %q, want %q", tt.name, got, tt.want)
		}
	}
}

func TestMergePath(t *testing.T) {
	exists := func(dir string) bool { return dir != "/missing" }
	got := mergePath("/opt/homebrew/bin:/usr/bin", "/usr/bin:/bin", []string{"/opt/homebrew/bin", "/missing", "/home/me/.local/bin"}, ":", exists)
	if want := "/opt/homebrew/bin:/usr/bin:/bin:/home/me/.local/bin"; got != want {
		t.Fatalf("mergePath = %q, want %q", got, want)
	}
	if got := mergePath("", "/usr/bin", nil, ":", exists); got != "/usr/bin" {
		t.Fatalf("no login PATH: %q", got)
	}
}

func TestLoginPathParsing(t *testing.T) {
	out := "Welcome!\n__WD_PATH__/opt/homebrew/bin:/usr/bin__WD_PATH__\n"
	if got := pathFromShellOutput(out); got != "/opt/homebrew/bin:/usr/bin" {
		t.Fatalf("pathFromShellOutput = %q", got)
	}
	if got := pathFromShellOutput("no marker"); got != "" {
		t.Fatalf("no marker: %q", got)
	}
}
