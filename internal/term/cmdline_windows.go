//go:build windows

package term

import "syscall"

func setRawCmdLine(attr *syscall.SysProcAttr, line string) { attr.CmdLine = line }
