//go:build !windows

package command

func systemCodePage() uint32 { return 65001 }

func decode(b []byte) string { return string(b) }
