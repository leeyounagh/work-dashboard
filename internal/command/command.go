// Package command runs a user-configured command line without a shell.
package command

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/leeyounagh/work-dashboard/internal/procutil"
)

// maxOutput caps what a widget keeps from a command.
const maxOutput = 256 << 10

// Split breaks a command line into arguments. Double quotes group words;
// there is no shell, so pipes, redirects and variables are plain text.
func Split(line string) ([]string, error) {
	var args []string
	var cur strings.Builder
	inQuote, hasArg := false, false
	for _, r := range line {
		switch {
		case r == '"':
			inQuote = !inQuote
			hasArg = true
		case (r == ' ' || r == '\t') && !inQuote:
			if hasArg {
				args = append(args, cur.String())
				cur.Reset()
				hasArg = false
			}
		default:
			cur.WriteRune(r)
			hasArg = true
		}
	}
	if inQuote {
		return nil, errors.New("따옴표가 닫히지 않았습니다")
	}
	if hasArg {
		args = append(args, cur.String())
	}
	if len(args) == 0 {
		return nil, errors.New("명령이 비어 있습니다")
	}
	return args, nil
}

// errBatch: Go hands .cmd/.bat arguments to cmd.exe parsing, where & | % act
// even though no shell is used. Refusing them keeps "no shell" true.
var errBatch = errors.New("배치 파일(.cmd/.bat)은 실행하지 않습니다. node.exe, pwsh.exe 처럼 실행 파일을 직접 지정하세요")

// isBatch reports whether Windows would run name as a batch file. Windows
// ignores trailing dots and spaces and an alternate data stream suffix
// (run.cmd., "run.cmd ", run.cmd::$DATA all start run.cmd).
func isBatch(name string) bool {
	// Both separators, so a Windows path is read the same on any OS.
	base := name[strings.LastIndexAny(name, `/\`)+1:]
	if i := strings.IndexByte(base, ':'); i >= 0 {
		base = base[:i]
	}
	ext := strings.ToLower(filepath.Ext(strings.TrimRight(base, ". ")))
	return ext == ".cmd" || ext == ".bat"
}

// Output is what a command printed.
type Output struct {
	Stdout    string `json:"stdout"`
	Stderr    string `json:"stderr"`
	ExitCode  int    `json:"exitCode"`
	Truncated bool   `json:"truncated"`
}

type capped struct {
	buf       bytes.Buffer
	truncated bool
}

func (c *capped) Write(p []byte) (int, error) {
	if room := maxOutput - c.buf.Len(); room > 0 {
		if len(p) > room {
			c.buf.Write(p[:room])
			c.truncated = true
		} else {
			c.buf.Write(p)
		}
	} else {
		c.truncated = true
	}
	return len(p), nil
}

// Run executes a command line in dir. A non-zero exit is reported in Output,
// not as an error; errors mean the command could not run at all.
func Run(ctx context.Context, dir, line string) (Output, error) {
	args, err := Split(line)
	if err != nil {
		return Output{}, err
	}
	// A relative path like scriptsun is found in dir when the process
	// starts, so it is resolved there (with PATHEXT) before the batch check.
	name := args[0]
	if strings.ContainsAny(name, `/\`) && !filepath.IsAbs(name) {
		name = filepath.Join(dir, name)
	}
	if isBatch(name) {
		return Output{}, errBatch
	}
	if resolved, err := exec.LookPath(name); err == nil {
		if isBatch(resolved) {
			return Output{}, errBatch
		}
		name = resolved
	}
	cmd := procutil.Background(exec.CommandContext(ctx, name, args[1:]...))
	cmd.Dir = dir
	cmd.WaitDelay = procutil.WaitDelay
	var stdout, stderr capped
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err = cmd.Run()
	out := Output{Stdout: decode(stdout.buf.Bytes()), Stderr: decode(stderr.buf.Bytes()), Truncated: stdout.truncated || stderr.truncated}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		out.ExitCode = exitErr.ExitCode()
		return out, nil
	}
	if err != nil {
		return Output{}, fmt.Errorf("%s 를 실행하지 못했습니다: %w", args[0], err)
	}
	return out, nil
}
