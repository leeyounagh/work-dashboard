// Package jsresolve finds what a JavaScript/TypeScript import points to, the
// way an editor's "go to definition" does: relative paths, tsconfig paths,
// and packages in node_modules (workspace packages included) with their
// package.json exports.
package jsresolve

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ErrNotFound means the import could not be resolved to a file.
var ErrNotFound = errors.New("import not found")

// Resolver reads only what Allow permits (nil allows everything).
type Resolver struct {
	Allow func(path string) bool
}

func (r Resolver) allowed(path string) bool { return r.Allow == nil || r.Allow(path) }

func (r Resolver) isFile(path string) bool {
	if !r.allowed(path) {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func (r Resolver) isDir(path string) bool {
	if !r.allowed(path) {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// maxReadBytes bounds a config or source file read while resolving.
const maxReadBytes = 4 << 20

func (r Resolver) read(path string) ([]byte, bool) {
	if !r.isFile(path) {
		return nil, false
	}
	info, err := os.Stat(path)
	if err != nil || info.Size() > maxReadBytes {
		return nil, false
	}
	b, err := os.ReadFile(path)
	return b, err == nil
}

// extensions tried after a bare path, in TypeScript's order.
var extensions = []string{".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".json"}

// sourceFor maps a written .js extension to the TypeScript sources it may stand for.
var sourceFor = []struct {
	js string
	ts []string
}{{".js", []string{".ts", ".tsx"}}, {".jsx", []string{".tsx"}}, {".mjs", []string{".mts"}}, {".cjs", []string{".cts"}}}

// file finds the file for base: as written, with an extension, a .js written
// for a .ts source, or the folder's index file.
func (r Resolver) file(base string) (string, bool) {
	if r.isFile(base) {
		return base, true
	}
	for _, ext := range extensions {
		if r.isFile(base + ext) {
			return base + ext, true
		}
	}
	for _, s := range sourceFor {
		if !strings.HasSuffix(base, s.js) {
			continue
		}
		for _, ts := range s.ts {
			if p := strings.TrimSuffix(base, s.js) + ts; r.isFile(p) {
				return p, true
			}
		}
	}
	if r.isDir(base) {
		for _, ext := range extensions {
			if p := filepath.Join(base, "index"+ext); r.isFile(p) {
				return p, true
			}
		}
	}
	return "", false
}

// Import returns the file that spec, imported from the file from, points to.
func (r Resolver) Import(from, spec string) (string, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" || strings.ContainsRune(spec, 0) {
		return "", ErrNotFound
	}
	dir := filepath.Dir(from)
	if strings.HasPrefix(spec, ".") {
		if p, ok := r.file(filepath.Join(dir, filepath.FromSlash(spec))); ok {
			return p, nil
		}
		return "", ErrNotFound
	}
	if cfg, ok := r.tsconfig(dir); ok {
		for _, base := range cfg.candidates(spec) {
			if p, ok := r.file(base); ok {
				return p, nil
			}
		}
	}
	if p, ok := r.nodeModule(dir, spec); ok {
		return p, nil
	}
	return "", ErrNotFound
}

// splitPackage splits "@scope/pkg/sub/path" into "@scope/pkg" and "sub/path".
func splitPackage(spec string) (string, string) {
	if strings.HasPrefix(spec, "@") {
		parts := strings.SplitN(spec, "/", 3)
		switch len(parts) {
		case 1:
			return spec, ""
		case 2:
			return spec, ""
		default:
			return parts[0] + "/" + parts[1], parts[2]
		}
	}
	name, sub, _ := strings.Cut(spec, "/")
	return name, sub
}

// nodeModule looks for the package in node_modules folders up from dir.
func (r Resolver) nodeModule(dir, spec string) (string, bool) {
	name, sub := splitPackage(spec)
	for d := dir; ; d = filepath.Dir(d) {
		pkgDir := filepath.Join(d, "node_modules", filepath.FromSlash(name))
		if r.isDir(pkgDir) {
			if p, ok := r.inPackage(pkgDir, sub); ok {
				return p, true
			}
		}
		if filepath.Dir(d) == d || !r.allowed(filepath.Dir(d)) {
			return "", false
		}
	}
}

type packageJSON struct {
	Main    string          `json:"main"`
	Module  string          `json:"module"`
	Types   string          `json:"types"`
	Typings string          `json:"typings"`
	Exports json.RawMessage `json:"exports"`
}

// inPackage resolves a subpath ("" for the package itself) inside a package.
func (r Resolver) inPackage(pkgDir, sub string) (string, bool) {
	var pkg packageJSON
	if b, ok := r.read(filepath.Join(pkgDir, "package.json")); ok {
		_ = json.Unmarshal(b, &pkg) // a broken package.json just has no fields
	}
	key := "."
	if sub != "" {
		key = "./" + sub
	}
	if len(pkg.Exports) > 0 {
		if target, ok := exportTarget(pkg.Exports, key); ok {
			if p, ok := r.file(filepath.Join(pkgDir, filepath.FromSlash(target))); ok {
				return p, true
			}
		}
	}
	if sub != "" {
		return r.file(filepath.Join(pkgDir, filepath.FromSlash(sub)))
	}
	for _, entry := range []string{pkg.Types, pkg.Typings, pkg.Module, pkg.Main} {
		if entry == "" {
			continue
		}
		if p, ok := r.file(filepath.Join(pkgDir, filepath.FromSlash(entry))); ok {
			return p, true
		}
	}
	return r.file(filepath.Join(pkgDir, "index"))
}

// conditions preferred when an export has several targets: types and
// sources first, since that is what an editor shows.
var conditions = []string{"types", "import", "module", "default", "require", "node", "browser"}

// exportTarget finds the target of key ("." or "./sub") in package.json exports.
func exportTarget(raw json.RawMessage, key string) (string, bool) {
	var asString string
	if json.Unmarshal(raw, &asString) == nil {
		return asString, key == "."
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return "", false
	}
	subpaths := false
	for k := range obj {
		if strings.HasPrefix(k, ".") {
			subpaths = true
			break
		}
	}
	if !subpaths { // conditions for "." only
		if key != "." {
			return "", false
		}
		return pickTarget(raw)
	}
	if v, ok := obj[key]; ok {
		return pickTarget(v)
	}
	// Patterns: "./lib/*" → "./src/lib/*"; the longest prefix wins.
	best, star := "", ""
	for k := range obj {
		prefix, suffix, ok := strings.Cut(k, "*")
		if !ok || !strings.HasPrefix(key, prefix) || !strings.HasSuffix(key, suffix) || len(key) < len(prefix)+len(suffix) {
			continue
		}
		if best == "" || len(prefix) > len(strings.SplitN(best, "*", 2)[0]) {
			best, star = k, key[len(prefix):len(key)-len(suffix)]
		}
	}
	if best == "" {
		return "", false
	}
	target, ok := pickTarget(obj[best])
	return strings.ReplaceAll(target, "*", star), ok
}

// pickTarget reads a target: a string, an array (first usable), or conditions.
func pickTarget(raw json.RawMessage) (string, bool) {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s, s != ""
	}
	var list []json.RawMessage
	if json.Unmarshal(raw, &list) == nil {
		for _, item := range list {
			if t, ok := pickTarget(item); ok {
				return t, true
			}
		}
		return "", false
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return "", false
	}
	for _, c := range conditions {
		if v, ok := obj[c]; ok {
			if t, ok := pickTarget(v); ok {
				return t, true
			}
		}
	}
	return "", false
}
