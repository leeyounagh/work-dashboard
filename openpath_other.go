//go:build !windows

package main

import (
	"fmt"
	"os/exec"
	"runtime"

	"github.com/leeyounagh/work-dashboard/internal/procutil"
)

// openWithDefaultApp opens a document with the desktop's handler: `open` on
// macOS, `xdg-open` on Linux. The path is one argument, never a shell line.
func openWithDefaultApp(path string) error {
	opener := "xdg-open"
	if runtime.GOOS == "darwin" {
		opener = "open"
	}
	cmd := procutil.Background(exec.Command(opener, path))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("파일을 열지 못했습니다 (%s): %w", opener, err)
	}
	go func() { _ = cmd.Wait() }() // reap it; the opener exits on its own
	return nil
}
