// Package launch turns a workspace into the terminal command to run.
package launch

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/leeyounagh/work-dashboard/internal/fsutil"
	"github.com/leeyounagh/work-dashboard/internal/term"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

// ClaudeOptions controls how Claude Code is started for a workspace.
type ClaudeOptions struct {
	Exe       string // resolved claude executable (may be a .cmd shim)
	SessionID string // new session UUID, or the session to resume
	Resume    bool   // resume SessionID instead of starting it
	NotesFile string // optional file appended to the system prompt
}

// ClaudeSpec runs claude in the first folder and adds the others with --add-dir.
func ClaudeSpec(ws workspace.Workspace, opts ClaudeOptions) (term.Spec, error) {
	if len(ws.Folders) == 0 {
		return term.Spec{}, fmt.Errorf("워크스페이스 %s 에 폴더가 없습니다 (no folders). 폴더를 먼저 추가하세요", ws.ID)
	}
	var args []string
	for _, folder := range ws.Folders[1:] {
		args = append(args, "--add-dir", folder)
	}
	if opts.SessionID != "" {
		flag := "--session-id"
		if opts.Resume {
			flag = "--resume"
		}
		args = append(args, flag, opts.SessionID)
	}
	if opts.NotesFile != "" {
		args = append(args, "--append-system-prompt-file", opts.NotesFile)
	}
	spec := term.Spec{Name: opts.Exe, Args: args, Dir: ws.Folders[0], Title: "Claude · " + ws.Name, Kind: "claude"}
	return wrapSpec(spec)
}

// ShellSpec opens an interactive shell in the workspace's first folder.
func ShellSpec(ws workspace.Workspace, shell string) (term.Spec, error) {
	dir := ""
	if len(ws.Folders) > 0 {
		dir = ws.Folders[0]
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			return term.Spec{}, fmt.Errorf("resolve home directory: %w", err)
		}
		dir = home
	}
	return term.Spec{Name: shell, Args: []string{"-NoLogo"}, Dir: dir, Title: "Shell · " + ws.Name, Kind: "shell"}, nil
}

// shimTarget matches the exe line of an npm-generated .cmd shim, e.g.
// "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*
var shimTarget = regexp.MustCompile(`(?m)^\s*"%dp0%\\?([^"%]+\.exe)"\s+%\*\s*$`)

// resolveShim returns the native exe an npm .cmd shim forwards to, so it can
// be run directly. Going through cmd.exe would expose the arguments to cmd
// parsing and the shim's %* re-splitting.
func resolveShim(shim string) (string, bool) {
	data, err := os.ReadFile(shim)
	if err != nil {
		return "", false
	}
	m := shimTarget.FindSubmatch(data)
	if m == nil {
		return "", false
	}
	exe := filepath.Join(filepath.Dir(shim), filepath.FromSlash(string(m[1])))
	if info, err := os.Stat(exe); err != nil || info.IsDir() {
		return "", false
	}
	return exe, true
}

func wrapSpec(spec term.Spec) (term.Spec, error) {
	if !isBatch(spec.Name) {
		return spec, nil
	}
	if exe, ok := resolveShim(spec.Name); ok {
		spec.Name = exe
		return spec, nil
	}
	if _, err := quoteForCmd(append([]string{spec.Name}, spec.Args...)); err != nil {
		return term.Spec{}, err
	}
	spec.Name, spec.Args = wrapBatch(spec.Name, spec.Args)
	spec.RawArgs = true
	return spec, nil
}

func isBatch(exe string) bool {
	lower := strings.ToLower(exe)
	return strings.HasSuffix(lower, ".cmd") || strings.HasSuffix(lower, ".bat")
}

// wrapBatch runs a .cmd/.bat file through cmd.exe, which CreateProcess needs.
// /s strips the outer quotes, so the inner command line is passed unchanged;
// /v:off keeps ! literal. Callers must check the arguments with quoteForCmd first.
func wrapBatch(exe string, args []string) (string, []string) {
	if !isBatch(exe) {
		return exe, args
	}
	line, _ := quoteForCmd(append([]string{exe}, args...))
	return "cmd.exe", []string{"/d", "/v:off", "/s", "/c", `"` + line + `"`}
}

// cmdUnsafe are characters that still act inside a quoted cmd.exe argument
// (% expansion, ! expansion) or that would end the quoting. Every argument
// is quoted, so & | < > ^ ( ) are passed through literally.
const cmdUnsafe = "%!\"\r\n"

// quoteForCmd quotes every argument for a cmd.exe command line.
func quoteForCmd(args []string) (string, error) {
	parts := make([]string, len(args))
	for i, a := range args {
		if strings.ContainsAny(a, cmdUnsafe) {
			return "", fmt.Errorf("인자 %q 에 cmd.exe 로 안전하게 넘길 수 없는 문자(%% ! \" 줄바꿈)가 있습니다", a)
		}
		// The shim hands %* to node, which reads \" as an escaped quote; double
		// trailing backslashes so they cannot swallow the closing quote.
		trimmed := strings.TrimRight(a, `\`)
		a += strings.Repeat(`\`, len(a)-len(trimmed))
		parts[i] = `"` + a + `"`
	}
	return strings.Join(parts, " "), nil
}

func notesPath(dir, id string) string {
	return filepath.Join(dir, id+".md")
}

// WriteNotes saves the workspace notes for --append-system-prompt-file and
// returns the file path. With no notes it removes any stale file and returns "".
func WriteNotes(dir string, ws workspace.Workspace) (string, error) {
	if strings.TrimSpace(ws.Notes) == "" {
		return "", RemoveNotes(dir, ws.ID)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("메모 폴더를 만들지 못했습니다: %w", err)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# Workspace: %s\n\nFolders:\n", ws.Name)
	for _, f := range ws.Folders {
		b.WriteString("- " + f + "\n")
	}
	b.WriteString("\n" + ws.Notes + "\n")
	path := notesPath(dir, ws.ID)
	// Atomic so a second Claude starting at the same time never reads half a file.
	if err := fsutil.WriteFileAtomic(path, []byte(b.String())); err != nil {
		return "", fmt.Errorf("%s 메모를 쓰지 못했습니다: %w", ws.ID, err)
	}
	return path, nil
}

// RemoveNotes deletes a workspace's notes file; a missing file is fine.
func RemoveNotes(dir, id string) error {
	if err := os.Remove(notesPath(dir, id)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("%s 메모를 지우지 못했습니다: %w", id, err)
	}
	return nil
}
