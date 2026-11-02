package jsresolve

import (
	"regexp"
	"strings"
)

// Location is a file and a 1-based line.
type Location struct {
	Path string `json:"path"`
	Line int    `json:"line"`
}

// maxHops bounds how many re-exports are followed.
const maxHops = 12

var (
	identPattern = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)
	// export { A, B as C } from "x"   /   export type { A } from "x"
	reExportList = regexp.MustCompile(`export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']`)
	// export * from "x"   (export * as ns from "x" names a namespace instead)
	reExportAll = regexp.MustCompile(`export\s+\*\s+from\s*["']([^"']+)["']`)
	reExportNS  = regexp.MustCompile(`export\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s*["']([^"']+)["']`)
	// import { A as B } / import B from — to follow "import X; export { X }".
	importStmt = regexp.MustCompile(`import\s+(?:type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']`)
	localList  = regexp.MustCompile(`export\s+(?:type\s+)?\{([^}]*)\}\s*(?:;|\n|$)`)
)

// declaration matches where name is declared in a line.
func declaration(name string) *regexp.Regexp {
	n := regexp.QuoteMeta(name)
	return regexp.MustCompile(`^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?` +
		`(?:function\s*\*?|const|let|var|class|interface|type|enum|namespace|module)\s+` + n + `(?:[^A-Za-z0-9_$]|$)`)
}

var defaultExport = regexp.MustCompile(`^\s*export\s+default\b`)

// Definition finds where name is declared, starting in file and following
// re-exports into the files they point to. An empty name, or "*" for a
// namespace import, means the file itself; "default" means its default export.
func (r Resolver) Definition(file, name string) (Location, error) {
	if name == "" || name == "*" {
		if !r.isFile(file) {
			return Location{}, ErrNotFound
		}
		return Location{Path: file, Line: 1}, nil
	}
	if name != "default" && !identPattern.MatchString(name) {
		return Location{}, ErrNotFound
	}
	return r.define(file, name, map[string]bool{}, 0)
}

func (r Resolver) define(file, name string, visited map[string]bool, hops int) (Location, error) {
	key := file + "\x00" + name
	if hops > maxHops || visited[key] {
		return Location{}, ErrNotFound
	}
	visited[key] = true
	b, ok := r.read(file)
	if !ok {
		return Location{}, ErrNotFound
	}
	text := string(b)
	lines := strings.Split(text, "\n")
	lineOf := func(offset int) int { return strings.Count(text[:offset], "\n") + 1 }

	// Declared here.
	decl := defaultExport
	if name != "default" {
		decl = declaration(name)
	}
	// Top-level declarations first: a name declared again inside a function
	// is usually not the one meant.
	for _, topLevel := range []bool{true, false} {
		for i, l := range lines {
			indented := l != strings.TrimLeft(l, " \t")
			if indented != topLevel && decl.MatchString(l) {
				return Location{Path: file, Line: i + 1}, nil
			}
		}
	}
	// export { orig as name } from "x"
	for _, m := range reExportList.FindAllStringSubmatchIndex(text, -1) {
		for item := range strings.SplitSeq(text[m[2]:m[3]], ",") {
			orig, exported := exportItem(item)
			if exported != name {
				continue
			}
			if loc, err := r.follow(file, text[m[4]:m[5]], orig, visited, hops); err == nil {
				return loc, nil
			}
			return Location{Path: file, Line: lineOf(m[0])}, nil
		}
	}
	// export * as name from "x": the namespace is the whole file.
	for _, m := range reExportNS.FindAllStringSubmatch(text, -1) {
		if m[1] == name {
			if target, err := r.Import(file, m[2]); err == nil {
				return Location{Path: target, Line: 1}, nil
			}
		}
	}
	// import { orig as local } from "x"; export { local as name }
	if local, ok := exportedLocally(text, name); ok {
		if local != name { // declared here under another name
			if loc, err := r.define(file, local, visited, hops+1); err == nil {
				return loc, nil
			}
		}
		for _, m := range importStmt.FindAllStringSubmatch(text, -1) {
			if orig, ok := importedAs(m[1], local); ok {
				if loc, err := r.follow(file, m[2], orig, visited, hops); err == nil {
					return loc, nil
				}
			}
		}
	}
	// export * from "x"
	if name != "default" {
		for _, m := range reExportAll.FindAllStringSubmatch(text, -1) {
			if loc, err := r.follow(file, m[1], name, visited, hops); err == nil {
				return loc, nil
			}
		}
	}
	return Location{}, ErrNotFound
}

func (r Resolver) follow(file, spec, name string, visited map[string]bool, hops int) (Location, error) {
	target, err := r.Import(file, spec)
	if err != nil {
		return Location{}, err
	}
	if name == "*" { // a namespace: the whole file
		return Location{Path: target, Line: 1}, nil
	}
	return r.define(target, name, visited, hops+1)
}

// exportItem reads "A", "A as B", "type A as B" into (original, exported).
func exportItem(item string) (string, string) {
	item = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(item), "type "))
	orig, exported, ok := strings.Cut(item, " as ")
	if !ok {
		return item, item
	}
	return strings.TrimSpace(orig), strings.TrimSpace(exported)
}

// exportedLocally finds the local name exported as name by an
// "export { local as name }" without "from".
func exportedLocally(text, name string) (string, bool) {
	for _, m := range localList.FindAllStringSubmatch(text, -1) {
		for item := range strings.SplitSeq(m[1], ",") {
			if local, exported := exportItem(item); exported == name {
				return local, true
			}
		}
	}
	return "", false
}

// importedAs finds the original name of local in an import clause
// ("X", "{ A as B }", "X, { A }", "* as ns"); "default" for a default import.
func importedAs(clause, local string) (string, bool) {
	clause = strings.TrimSpace(clause)
	if open := strings.Index(clause, "{"); open >= 0 {
		end := strings.Index(clause, "}")
		if end > open {
			for item := range strings.SplitSeq(clause[open+1:end], ",") {
				if orig, as := exportItem(item); as == local && as != "" {
					return orig, true
				}
			}
		}
		clause = strings.TrimSuffix(strings.TrimSpace(clause[:open]), ",")
	}
	for part := range strings.SplitSeq(clause, ",") {
		part = strings.TrimSpace(part)
		if ns, ok := strings.CutPrefix(part, "* as "); ok {
			if strings.TrimSpace(ns) == local {
				return "*", true
			}
		} else if part == local {
			return "default", true
		}
	}
	return "", false
}
