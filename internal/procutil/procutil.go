// Package procutil holds helpers for starting helper processes.
package procutil

import (
	"os/exec"
	"time"
)

// WaitDelay bounds how long Wait blocks after a context kill when a child
// process still holds the output pipes (e.g. a .cmd that started node).
const WaitDelay = 5 * time.Second

// Background configures cmd to run without a visible console window. The
// dashboard is a GUI app, so console tools (git, gh, claude -p) would
// otherwise flash a window on Windows.
func Background(cmd *exec.Cmd) *exec.Cmd {
	hide(cmd)
	return cmd
}
