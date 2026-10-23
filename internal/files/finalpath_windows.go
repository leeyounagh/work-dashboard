//go:build windows

package files

import (
	"os"
	"strings"

	"golang.org/x/sys/windows"
)

// finalPath returns the path the open handle really refers to, after every
// symlink, junction and mount point. Checking this (instead of resolving the
// name first) cannot be fooled by junctions or by a swap between check and open.
func finalPath(f *os.File) (string, error) {
	h := windows.Handle(f.Fd())
	buf := make([]uint16, windows.MAX_PATH)
	for {
		n, err := windows.GetFinalPathNameByHandle(h, &buf[0], uint32(len(buf)), 0)
		if err != nil {
			return "", err
		}
		if int(n) < len(buf) {
			return stripVerbatim(windows.UTF16ToString(buf[:n])), nil
		}
		buf = make([]uint16, n+1)
	}
}

// stripVerbatim turns \\?\C:\x into C:\x and \\?\UNC\host\share into \\host\share.
func stripVerbatim(p string) string {
	if rest, ok := strings.CutPrefix(p, `\\?\UNC\`); ok {
		return `\\` + rest
	}
	return strings.TrimPrefix(p, `\\?\`)
}
