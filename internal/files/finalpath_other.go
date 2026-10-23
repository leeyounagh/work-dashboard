//go:build !windows

package files

import (
	"os"
	"path/filepath"
)

// finalPath returns the real path of an open file.
func finalPath(f *os.File) (string, error) {
	return filepath.EvalSymlinks(f.Name())
}
