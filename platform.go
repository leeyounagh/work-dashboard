package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/procutil"
)

// shellFor is the interactive shell for plain terminals: PowerShell on
// Windows (7 when installed), the user's login shell elsewhere.
func shellFor(goos string, getenv func(string) string, look func(string) (string, error)) string {
	if goos == "windows" {
		if _, err := look("pwsh"); err == nil {
			return "pwsh"
		}
		return "powershell.exe"
	}
	// A Unix absolute path (checked as text: this also runs in tests on Windows).
	if sh := getenv("SHELL"); strings.HasPrefix(sh, "/") {
		return sh
	}
	for _, name := range []string{"zsh", "bash"} {
		if path, err := look(name); err == nil {
			return path
		}
	}
	return "/bin/sh"
}

func preferredShell() string {
	return shellFor(runtime.GOOS, os.Getenv, exec.LookPath)
}

const pathMarker = "__WD_PATH__"

// pathFromShellOutput finds the PATH printed between markers (profiles may
// print other text around it).
func pathFromShellOutput(out string) string {
	_, rest, ok := strings.Cut(out, pathMarker)
	if !ok {
		return ""
	}
	path, _, ok := strings.Cut(rest, pathMarker)
	if !ok {
		return ""
	}
	return strings.TrimSpace(path)
}

// mergePath puts the login shell's PATH first, then the current one, then
// extra directories that exist, without repeats.
func mergePath(login, current string, extras []string, sep string, exists func(string) bool) string {
	seen := map[string]bool{}
	out := []string{}
	add := func(dir string, check bool) {
		if dir == "" || seen[dir] || (check && !exists(dir)) {
			return
		}
		seen[dir] = true
		out = append(out, dir)
	}
	for _, d := range strings.Split(login, sep) {
		add(d, false)
	}
	for _, d := range strings.Split(current, sep) {
		add(d, false)
	}
	for _, d := range extras {
		add(d, true)
	}
	return strings.Join(out, sep)
}

// utf8Locale returns the LANG to set for an app started from the Dock or a
// launcher, which gets no locale: then pbcopy/pbpaste (the clipboard) and the
// terminals' programs fall back to a legacy encoding and garble Korean.
// "" means the environment already names a locale.
func utf8Locale(getenv func(string) string) string {
	for _, k := range []string{"LC_ALL", "LC_CTYPE", "LANG"} {
		if getenv(k) != "" {
			return ""
		}
	}
	return "en_US.UTF-8"
}

// fixPath gives a macOS / Linux app started from the Dock or a launcher the
// PATH of the user's terminal, so claude, gh and git installed with
// Homebrew, npm or the Claude installer are found. Windows apps already get
// the user's PATH.
func fixPath() {
	if runtime.GOOS == "windows" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// -i -l: the same profile files an interactive terminal reads.
	cmd := procutil.Background(exec.CommandContext(ctx, preferredShell(), "-ilc", `printf '`+pathMarker+`%s`+pathMarker+`' "$PATH"`))
	cmd.WaitDelay = procutil.WaitDelay
	out, _ := cmd.Output()
	home, _ := os.UserHomeDir()
	extras := []string{
		"/opt/homebrew/bin", "/usr/local/bin",
		filepath.Join(home, ".local", "bin"), filepath.Join(home, ".claude", "local"),
		filepath.Join(home, ".npm-global", "bin"), filepath.Join(home, ".bun", "bin"),
	}
	exists := func(dir string) bool {
		info, err := os.Stat(dir)
		return err == nil && info.IsDir()
	}
	if lang := utf8Locale(os.Getenv); lang != "" {
		_ = os.Setenv("LANG", lang)
	}
	_ = os.Setenv("PATH", mergePath(pathFromShellOutput(string(out)), os.Getenv("PATH"), extras, string(os.PathListSeparator), exists))
}
