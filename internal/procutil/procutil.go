// Package procutil holds helpers for starting helper processes.
package procutil

import "os/exec"

// Background configures cmd to run without a visible console window. The
// dashboard is a GUI app, so console tools (git, gh, claude -p) would
// otherwise flash a window on Windows.
func Background(cmd *exec.Cmd) *exec.Cmd {
	hide(cmd)
	return cmd
}
