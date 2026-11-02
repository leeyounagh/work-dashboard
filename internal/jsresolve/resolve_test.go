package jsresolve

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// monorepo writes a small pnpm-style workspace: an app with tsconfig paths
// and a UI package with exports, linked into the app's node_modules.
func monorepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"tsconfig.json": `{
  // shared options
  "compilerOptions": { "strict": true, },
}`,
		"apps/web/tsconfig.json": `{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    /* app aliases */
    "paths": { "@/*": ["./*"], "@ui/*": ["../../packages/ui/src/*"] }
  }
}`,
		"apps/web/app/page.tsx":                    `import { NeoTitle } from '@repo/ui/titles';`,
		"apps/web/app/util.ts":                     "export const util = 1;\n",
		"apps/web/components/Header.tsx":           "\n\nexport default function Header() {}\n",
		"packages/ui/package.json":                 `{"name":"@repo/ui","main":"./src/index.ts","exports":{".":{"types":"./src/index.ts","default":"./src/index.ts"},"./titles":{"types":"./src/titles/index.ts"},"./lib/*":"./src/lib/*","./globals.css":"./src/globals.css"}}`,
		"packages/ui/src/index.ts":                 "export * from './titles';\nexport * as lib from './lib/cn';\n",
		"packages/ui/src/titles/index.ts":          "// NeoTitle\nexport { NeoTitle } from \"./NeoTitle\";\nexport type { NeoTitleProps as Props } from './NeoTitle.types';\n",
		"packages/ui/src/titles/NeoTitle.tsx":      "import React from 'react';\n\nexport const NeoTitle = () => null;\n",
		"packages/ui/src/titles/NeoTitle.types.ts": "export interface NeoTitleProps {\n  title: string;\n}\n",
		"packages/ui/src/lib/cn.ts":                "export function cn() {}\n",
		"packages/ui/src/globals.css":              "body {}\n",
		"packages/ui/src/esm.ts":                   "import { util } from './helper.js';\nexport { util as helper };\n",
		"packages/ui/src/helper.ts":                "\nexport const util = 2;\n",
		"node_modules/lodash/package.json":         `{"name":"lodash","main":"lodash.js"}`,
		"node_modules/lodash/lodash.js":            "module.exports = {};\n",
	}
	for name, body := range files {
		p := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	link := filepath.Join(root, "apps", "web", "node_modules", "@repo", "ui")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "packages", "ui"), link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	return root
}

func rel(t *testing.T, root, path string) string {
	t.Helper()
	r, err := filepath.Rel(root, path)
	if err != nil {
		t.Fatal(err)
	}
	return filepath.ToSlash(r)
}

func TestImport(t *testing.T) {
	root := monorepo(t)
	page := filepath.Join(root, "apps", "web", "app", "page.tsx")
	var r Resolver
	cases := map[string]string{
		"./util":               "apps/web/app/util.ts",
		"../components/Header": "apps/web/components/Header.tsx",
		"@/components/Header":  "apps/web/components/Header.tsx",
		"@ui/titles":           "packages/ui/src/titles/index.ts",
		"@repo/ui":             "apps/web/node_modules/@repo/ui/src/index.ts",
		"@repo/ui/titles":      "apps/web/node_modules/@repo/ui/src/titles/index.ts",
		"@repo/ui/lib/cn.ts":   "apps/web/node_modules/@repo/ui/src/lib/cn.ts",
		"@repo/ui/globals.css": "apps/web/node_modules/@repo/ui/src/globals.css",
		"lodash":               "node_modules/lodash/lodash.js",
	}
	for spec, want := range cases {
		got, err := r.Import(page, spec)
		if err != nil {
			t.Errorf("%s: %v", spec, err)
			continue
		}
		if rel(t, root, got) != want {
			t.Errorf("%s = %s, want %s", spec, rel(t, root, got), want)
		}
	}
	for _, spec := range []string{"./missing", "@repo/ui/nope", "react", ""} {
		if got, err := r.Import(page, spec); err == nil {
			t.Errorf("%s resolved to %s", spec, got)
		}
	}
}

func TestDefinitionFollowsReExports(t *testing.T) {
	root := monorepo(t)
	page := filepath.Join(root, "apps", "web", "app", "page.tsx")
	var r Resolver
	index, err := r.Import(page, "@repo/ui")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, want string
		line       int
	}{
		{"NeoTitle", "NeoTitle.tsx", 3}, // index → export * → titles → export { } from
		{"Props", "NeoTitle.types.ts", 1},
		{"lib", "cn.ts", 1},
		{"", "index.ts", 1},
	}
	for _, c := range cases {
		loc, err := r.Definition(index, c.name)
		if err != nil {
			t.Errorf("%q: %v", c.name, err)
			continue
		}
		if filepath.Base(loc.Path) != c.want || loc.Line != c.line {
			t.Errorf("%q = %s:%d, want %s:%d", c.name, loc.Path, loc.Line, c.want, c.line)
		}
	}
	header := filepath.Join(root, "apps", "web", "components", "Header.tsx")
	if loc, err := r.Definition(header, "default"); err != nil || loc.Line != 3 {
		t.Errorf("default = %+v, %v", loc, err)
	}
	esm := filepath.Join(root, "packages", "ui", "src", "esm.ts")
	if loc, err := r.Definition(esm, "helper"); err != nil || filepath.Base(loc.Path) != "helper.ts" || loc.Line != 2 {
		t.Errorf("import then export = %+v, %v", loc, err)
	}
	if _, err := r.Definition(index, "Nope"); err == nil {
		t.Error("an unknown name must not resolve")
	}
	if _, err := r.Definition(index, "a.b"); err == nil {
		t.Error("a bad name must not resolve")
	}
}

func TestAllowLimitsReads(t *testing.T) {
	root := monorepo(t)
	page := filepath.Join(root, "apps", "web", "app", "page.tsx")
	r := Resolver{Allow: func(p string) bool { return !strings.Contains(filepath.ToSlash(p), "packages/ui") }}
	if _, err := r.Import(page, "@ui/titles"); err == nil {
		t.Fatal("a disallowed target must not resolve")
	}
	if _, err := r.Import(page, "./util"); err != nil {
		t.Fatal(err)
	}
}

func TestStripJSONC(t *testing.T) {
	got := string(StripJSONC([]byte("{\"a\": \"x // y\", /* c */ \"b\": [1, 2, ], // end\n}")))
	if strings.Contains(got, "/*") || strings.Contains(got, "end") || !strings.Contains(got, "x // y") || strings.Contains(got, "2, ]") {
		t.Fatalf("StripJSONC = %q", got)
	}
}

// write puts files under root.
func write(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for name, body := range files {
		p := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestImportConfigShapes(t *testing.T) {
	root := t.TempDir()
	write(t, root, map[string]string{
		// baseUrl only
		"a/tsconfig.json":             `{"compilerOptions":{"baseUrl":"src"}}`,
		"a/src/components/Button.tsx": "export const Button = 1;\n",
		"a/src/app.ts":                "",
		// solution style: paths live in a referenced config
		"b/tsconfig.json":     `{"files":[],"references":[{"path":"./tsconfig.app.json"}]}`,
		"b/tsconfig.app.json": `{"compilerOptions":{"paths":{"~/*":["./src/*"]}}}`,
		"b/src/lib/x.ts":      "",
		"b/src/main.ts":       "",
		// .js written for a .ts source, and export patterns
		"c/main.ts":                     "",
		"c/util.ts":                     "",
		"c/node_modules/p/package.json": `{"exports":{"./feature/*":{"types":"./types/*.d.ts"}}}`,
		"c/node_modules/p/types/a.d.ts": "",
	})
	var r Resolver
	cases := []struct{ from, spec, want string }{
		{"a/src/app.ts", "components/Button", "a/src/components/Button.tsx"},
		{"b/src/main.ts", "~/lib/x", "b/src/lib/x.ts"},
		{"c/main.ts", "./util.js", "c/util.ts"},
		{"c/main.ts", "p/feature/a", "c/node_modules/p/types/a.d.ts"},
	}
	for _, c := range cases {
		got, err := r.Import(filepath.Join(root, filepath.FromSlash(c.from)), c.spec)
		if err != nil || rel(t, root, got) != c.want {
			t.Errorf("%s from %s = %s, %v; want %s", c.spec, c.from, got, err, c.want)
		}
	}
}

func TestDefinitionShapes(t *testing.T) {
	root := t.TempDir()
	write(t, root, map[string]string{
		"alias.ts":  "const Button = 1;\n\nexport { Button as default, Button as Public };\n",
		"dollar.ts": "export const user$ = 1;\nexport const user = 2;\n",
		"scope.ts":  "function a() {\n  const result = 1;\n}\nconst result = 2;\n",
		"cycle1.ts": "export * from './cycle2';\n",
		"cycle2.ts": "export * from './cycle1';\n",
	})
	var r Resolver
	cases := []struct {
		file, name string
		line       int
	}{
		{"alias.ts", "default", 1},
		{"alias.ts", "Public", 1},
		{"dollar.ts", "user$", 1},
		{"dollar.ts", "user", 2},
		{"scope.ts", "result", 4}, // top level first
	}
	for _, c := range cases {
		loc, err := r.Definition(filepath.Join(root, c.file), c.name)
		if err != nil || loc.Line != c.line {
			t.Errorf("%s %s = %+v, %v; want line %d", c.file, c.name, loc, err, c.line)
		}
	}
	if _, err := r.Definition(filepath.Join(root, "cycle1.ts"), "Nope"); err == nil {
		t.Error("a re-export cycle must end without a result")
	}
}

// A package linked to a folder outside the allowed roots is not read.
func TestAllowStopsLinksLeavingTheRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	write(t, root, map[string]string{"app/main.ts": ""})
	write(t, outside, map[string]string{"pkg/package.json": `{"main":"index.js"}`, "pkg/index.js": ""})
	link := filepath.Join(root, "app", "node_modules", "pkg")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "pkg"), link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	inside := func(p string) bool {
		real, err := filepath.EvalSymlinks(p)
		if err != nil {
			real = p
		}
		r, err := filepath.Rel(root, real)
		return err == nil && !strings.HasPrefix(r, "..")
	}
	r := Resolver{Allow: inside}
	if got, err := r.Import(filepath.Join(root, "app", "main.ts"), "pkg"); err == nil {
		t.Fatalf("resolved through a link leaving the root: %s", got)
	}
}
