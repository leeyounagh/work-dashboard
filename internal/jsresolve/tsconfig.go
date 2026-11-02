package jsresolve

import (
	"encoding/json"
	"path/filepath"
	"sort"
	"strings"
)

// tsPaths are the "paths" in effect for a folder.
type tsPaths struct {
	baseURL  string              // absolute baseUrl, "" when none is set
	pathsDir string              // folder of the config that set paths
	paths    map[string][]string // "@/*" → ["./src/*"]
}

type rawTSConfig struct {
	Extends    json.RawMessage `json:"extends"`
	References []struct {
		Path string `json:"path"`
	} `json:"references"`
	CompilerOptions struct {
		BaseURL *string              `json:"baseUrl"`
		Paths   *map[string][]string `json:"paths"`
	} `json:"compilerOptions"`
}

// maxExtends bounds a tsconfig "extends" chain.
const maxExtends = 8

// tsconfig finds the nearest tsconfig.json (or jsconfig.json) up from dir.
func (r Resolver) tsconfig(dir string) (tsPaths, bool) {
	for d := dir; ; d = filepath.Dir(d) {
		for _, name := range []string{"tsconfig.json", "jsconfig.json"} {
			if p := filepath.Join(d, name); r.isFile(p) {
				return r.withReferences(p)
			}
		}
		if filepath.Dir(d) == d || !r.allowed(filepath.Dir(d)) {
			return tsPaths{}, false
		}
	}
}

// withReferences loads a config; a solution-style one without paths (only
// "references", as in Vite templates) lends the first referenced config's.
func (r Resolver) withReferences(path string) (tsPaths, bool) {
	cfg, ok := r.loadTSConfig(path, 0)
	if !ok || cfg.paths != nil || cfg.baseURL != "" {
		return cfg, ok
	}
	b, _ := r.read(path)
	var raw rawTSConfig
	if json.Unmarshal(StripJSONC(b), &raw) != nil {
		return cfg, true
	}
	for _, ref := range raw.References {
		p := filepath.Join(filepath.Dir(path), filepath.FromSlash(ref.Path))
		if !strings.HasSuffix(p, ".json") {
			p = filepath.Join(p, "tsconfig.json")
		}
		if sub, ok := r.loadTSConfig(p, 1); ok && (sub.paths != nil || sub.baseURL != "") {
			return sub, true
		}
	}
	return cfg, true
}

// loadTSConfig reads a config and what it extends. A child's paths replace
// its parent's; paths are relative to baseUrl, or else to their own config.
func (r Resolver) loadTSConfig(path string, depth int) (tsPaths, bool) {
	b, ok := r.read(path)
	if !ok || depth > maxExtends {
		return tsPaths{}, false
	}
	var cfg rawTSConfig
	if json.Unmarshal(StripJSONC(b), &cfg) != nil {
		return tsPaths{}, false
	}
	dir := filepath.Dir(path)
	var out tsPaths
	if parent := extendsPath(cfg.Extends, dir); parent != "" {
		out, _ = r.loadTSConfig(parent, depth+1)
	}
	if cfg.CompilerOptions.BaseURL != nil {
		out.baseURL = filepath.Join(dir, filepath.FromSlash(*cfg.CompilerOptions.BaseURL))
	}
	if cfg.CompilerOptions.Paths != nil {
		out.paths = *cfg.CompilerOptions.Paths
		out.pathsDir = dir
	}
	return out, true
}

// extendsPath resolves a relative "extends" (a string, or the last of a list,
// which wins). Package names (e.g. "@tsconfig/node20") are not followed.
func extendsPath(raw json.RawMessage, dir string) string {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		var list []string
		if json.Unmarshal(raw, &list) != nil || len(list) == 0 {
			return ""
		}
		s = list[len(list)-1]
	}
	if !strings.HasPrefix(s, ".") {
		return ""
	}
	p := filepath.Join(dir, filepath.FromSlash(s))
	if !strings.HasSuffix(p, ".json") {
		p += ".json"
	}
	return p
}

// candidates lists where spec may point by the paths, best match first.
func (c tsPaths) candidates(spec string) []string {
	base := c.baseURL
	if base == "" {
		base = c.pathsDir
	}
	if base == "" {
		return nil
	}
	// Paths resolve before a bare baseUrl lookup.
	type match struct {
		rank    int
		star    string
		targets []string
	}
	var matches []match
	for pattern, targets := range c.paths {
		prefix, suffix, wild := strings.Cut(pattern, "*")
		switch {
		case !wild && pattern == spec:
			matches = append(matches, match{rank: len(pattern) + 1, targets: targets})
		case wild && strings.HasPrefix(spec, prefix) && strings.HasSuffix(spec, suffix) && len(spec) >= len(prefix)+len(suffix):
			matches = append(matches, match{rank: len(prefix), star: spec[len(prefix) : len(spec)-len(suffix)], targets: targets})
		}
	}
	sort.SliceStable(matches, func(i, j int) bool { return matches[i].rank > matches[j].rank })
	var out []string
	for _, m := range matches {
		for _, t := range m.targets {
			out = append(out, filepath.Join(base, filepath.FromSlash(strings.ReplaceAll(t, "*", m.star))))
		}
	}
	// A bare baseUrl also resolves "components/Button" under it.
	if c.baseURL != "" {
		out = append(out, filepath.Join(c.baseURL, filepath.FromSlash(spec)))
	}
	return out
}

// StripJSONC removes comments and trailing commas, as tsconfig allows.
func StripJSONC(b []byte) []byte {
	out := make([]byte, 0, len(b))
	inString, escaped := false, false
	for i := 0; i < len(b); i++ {
		c := b[i]
		if inString {
			out = append(out, c)
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == '"':
				inString = false
			}
			continue
		}
		switch {
		case c == '"':
			inString = true
			out = append(out, c)
		case c == '/' && i+1 < len(b) && b[i+1] == '/':
			for i < len(b) && b[i] != '\n' {
				i++
			}
			if i < len(b) {
				out = append(out, '\n')
			}
		case c == '/' && i+1 < len(b) && b[i+1] == '*':
			i += 2
			for i+1 < len(b) && !(b[i] == '*' && b[i+1] == '/') {
				i++
			}
			i++
		case c == ',' && trailing(b[i+1:]):
			// A trailing comma before } or ] is dropped.
		default:
			out = append(out, c)
		}
	}
	return out
}

// trailing reports whether only whitespace and comments come before } or ].
func trailing(rest []byte) bool {
	for i := 0; i < len(rest); i++ {
		switch c := rest[i]; {
		case c == ' ' || c == '\t' || c == '\r' || c == '\n':
		case c == '/' && i+1 < len(rest) && rest[i+1] == '/':
			for i < len(rest) && rest[i] != '\n' {
				i++
			}
		case c == '/' && i+1 < len(rest) && rest[i+1] == '*':
			i += 2
			for i+1 < len(rest) && !(rest[i] == '*' && rest[i+1] == '/') {
				i++
			}
			i++
		default:
			return c == '}' || c == ']'
		}
	}
	return false
}
