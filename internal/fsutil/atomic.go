// Package fsutil holds small file helpers shared by the stores.
package fsutil

import (
	"os"
	"path/filepath"
)

// WriteFileAtomic writes to a unique temp file, syncs it, then renames it over
// target, so readers never see a half-written file and a crash never leaves a
// truncated one.
func WriteFileAtomic(target string, data []byte) (err error) {
	f, err := os.CreateTemp(filepath.Dir(target), filepath.Base(target)+".*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(tmp)
		}
	}()
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, target)
}
