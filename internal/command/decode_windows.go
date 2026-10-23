package command

import (
	"unicode/utf8"

	"golang.org/x/sys/windows"
)

func systemCodePage() uint32 { return windows.GetACP() }

// validUTF8 ignores a rune cut off by the output cap.
func validUTF8(b []byte) bool {
	for i := 0; i < utf8.UTFMax-1 && len(b) > 0 && !utf8.Valid(b); i++ {
		b = b[:len(b)-1]
	}
	return utf8.Valid(b)
}

// decode reads command output: UTF-8 as is, otherwise the system code page
// (Windows tools such as PowerShell 5 print CP949 on Korean Windows).
func decode(b []byte) string {
	if len(b) == 0 || validUTF8(b) {
		return string(b)
	}
	cp := systemCodePage()
	n, err := windows.MultiByteToWideChar(cp, 0, &b[0], int32(len(b)), nil, 0)
	if err != nil || n == 0 {
		return string(b)
	}
	buf := make([]uint16, n)
	if _, err := windows.MultiByteToWideChar(cp, 0, &b[0], int32(len(b)), &buf[0], n); err != nil {
		return string(b)
	}
	return windows.UTF16ToString(buf)
}
