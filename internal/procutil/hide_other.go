//go:build !windows

package procutil

import "os/exec"

func hide(*exec.Cmd) {}
