package files

import (
	"fmt"
	"os"
	"path/filepath"
)

// Pin is one file allowed by itself, fixed to what it really was when pinned:
// if the path is later swapped for a link elsewhere, the pin no longer opens it.
type Pin struct {
	Path string // cleaned, as given
	Real string // links and junctions followed, at pin time
}

// PinFile pins an existing regular file; folders and missing files fail.
func PinFile(path string) (Pin, error) {
	if !filepath.IsAbs(path) {
		return Pin{}, fmt.Errorf("%s is not absolute", path)
	}
	clean := filepath.Clean(path)
	f, err := os.Open(clean)
	if err != nil {
		return Pin{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return Pin{}, err
	}
	if !info.Mode().IsRegular() {
		return Pin{}, fmt.Errorf("%s is not a regular file", path)
	}
	real, err := finalPath(f)
	if err != nil {
		return Pin{}, err
	}
	return Pin{Path: clean, Real: real}, nil
}

// WithPins also allows the pinned files. A file root admits only itself.
func (g Guard) WithPins(pins []Pin) Guard {
	out := Guard{roots: append([]string(nil), g.roots...), realRoots: append([]string(nil), g.realRoots...)}
	for _, p := range pins {
		out.roots = append(out.roots, p.Path)
		out.realRoots = append(out.realRoots, p.Real)
	}
	return out
}
