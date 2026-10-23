//go:build !windows

package term

import "syscall"

// Raw command lines are a Windows concept; Unix receives Args as-is.
func setRawCmdLine(*syscall.SysProcAttr, string) {}
