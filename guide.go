package main

import (
	"encoding/json"
	"math/rand/v2"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Article is a site the office guide suggests reading.
type Article struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Tech string `json:"tech"` // what it was picked for ("AI" when nothing was recognised)
}

type site struct{ Name, URL string }

// techName labels each detected technology.
var techName = map[string]string{
	"go": "Go", "nextjs": "Next.js", "react": "React", "vue": "Vue", "typescript": "TypeScript", "vite": "Vite",
	"flutter": "Flutter", "mobile": "앱", "wails": "Wails", "rust": "Rust", "python": "Python", "docker": "Docker", "ai": "AI",
}

// topicAlias maps what people type as a guide topic to a known technology.
var topicAlias = map[string]string{
	"next": "nextjs", "next.js": "nextjs", "ts": "typescript", "golang": "go", "dart": "flutter",
	"app": "mobile", "앱": "mobile", "android": "mobile", "ios": "mobile", "모바일": "mobile",
}

// guideTopics turns a workspace's topics into known technologies (unknown
// ones are dropped, so a typo falls back to detection).
func guideTopics(topics []string) []string {
	out := []string{}
	for _, t := range topics {
		t = strings.ToLower(strings.TrimSpace(t))
		if alias, ok := topicAlias[t]; ok {
			t = alias
		}
		if _, ok := articleSites[t]; ok && t != "ai" && !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	return out
}

// articleSites are well-kept blogs per technology; "ai" is the fallback.
var articleSites = map[string][]site{
	"go":         {{"Go 블로그", "https://go.dev/blog/"}, {"Alex Edwards", "https://www.alexedwards.net/blog"}, {"Dave Cheney", "https://dave.cheney.net/"}, {"우아한형제들 기술블로그", "https://techblog.woowahan.com/"}},
	"nextjs":     {{"Next.js 블로그", "https://nextjs.org/blog"}, {"Vercel 블로그", "https://vercel.com/blog"}, {"토스 기술블로그", "https://toss.tech/"}},
	"react":      {{"React 블로그", "https://react.dev/blog"}, {"overreacted", "https://overreacted.io/"}, {"토스 기술블로그", "https://toss.tech/"}},
	"vue":        {{"Vue 블로그", "https://blog.vuejs.org/"}, {"카카오 기술블로그", "https://tech.kakao.com/blog"}},
	"typescript": {{"TypeScript 블로그", "https://devblogs.microsoft.com/typescript/"}, {"Total TypeScript", "https://www.totaltypescript.com/articles"}},
	"vite":       {{"Vite 블로그", "https://vite.dev/blog"}},
	"flutter":    {{"Flutter 블로그", "https://medium.com/flutter"}, {"Dart 블로그", "https://medium.com/dartlang"}},
	// Apps in general: Android, iOS, cross-platform, and Korean app teams.
	"mobile": {
		{"Android Developers 블로그", "https://android-developers.googleblog.com/"}, {"Apple Developer 뉴스", "https://developer.apple.com/news/"},
		{"Flutter 블로그", "https://medium.com/flutter"}, {"당근 테크 블로그", "https://medium.com/daangn"},
		{"LY Corporation 기술 블로그", "https://techblog.lycorp.co.jp/ko"}, {"토스 기술블로그", "https://toss.tech/"},
	},
	"wails":  {{"Wails 블로그", "https://wails.io/blog"}},
	"rust":   {{"Rust 블로그", "https://blog.rust-lang.org/"}},
	"python": {{"Real Python", "https://realpython.com/"}},
	"docker": {{"Docker 블로그", "https://www.docker.com/blog/"}},
	"ai": {
		{"Anthropic Engineering", "https://www.anthropic.com/engineering"}, {"Anthropic News", "https://www.anthropic.com/news"},
		{"Hugging Face 블로그", "https://huggingface.co/blog"}, {"Simon Willison", "https://simonwillison.net/"},
	},
}

// jsDeps maps package.json dependencies to technologies.
var jsDeps = map[string]string{"next": "nextjs", "react": "react", "vue": "vue", "nuxt": "vue", "typescript": "typescript", "vite": "vite"}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// detectTech looks at the files at the top of each folder (go.mod,
// package.json, pubspec.yaml, ...). Nothing is sent anywhere.
func detectTech(folders []string) []string {
	found := []string{}
	add := func(tech string) {
		for _, t := range found {
			if t == tech {
				return
			}
		}
		found = append(found, tech)
	}
	for _, dir := range folders {
		markers := map[string][]string{
			"go.mod": {"go"}, "pubspec.yaml": {"flutter", "mobile"}, "wails.json": {"wails"}, "Cargo.toml": {"rust"},
			"pyproject.toml": {"python"}, "requirements.txt": {"python"}, "Dockerfile": {"docker"},
			"android": {"mobile"}, "ios": {"mobile"},
		}
		for file, techs := range markers {
			if exists(filepath.Join(dir, file)) {
				for _, tech := range techs {
					add(tech)
				}
			}
		}
		for _, pkg := range packageJSONs(dir) {
			data, err := os.ReadFile(pkg)
			if err != nil {
				continue
			}
			var p struct {
				Deps    map[string]any `json:"dependencies"`
				DevDeps map[string]any `json:"devDependencies"`
			}
			if json.Unmarshal(data, &p) != nil {
				continue
			}
			for dep, tech := range jsDeps {
				if p.Deps[dep] != nil || p.DevDeps[dep] != nil {
					add(tech)
				}
			}
		}
	}
	return found
}

// packageJSONs lists the package.json files that say what a folder is
// built with: its own, a Wails app's frontend/, and monorepo apps/* and
// packages/* (one level, so a scan stays quick).
func packageJSONs(dir string) []string {
	out := []string{filepath.Join(dir, "package.json"), filepath.Join(dir, "frontend", "package.json")}
	for _, group := range []string{"apps", "packages"} {
		matches, _ := filepath.Glob(filepath.Join(dir, group, "*", "package.json"))
		out = append(out, matches...)
	}
	return out
}

// pickArticle picks one site among the detected technologies' blogs (or an
// AI site when none). intn(n) returns a number in [0, n).
func pickArticle(techs []string, intn func(n int) int) Article {
	type choice struct {
		site
		tech string
	}
	choices := []choice{}
	for _, t := range techs {
		for _, s := range articleSites[t] {
			choices = append(choices, choice{s, t})
		}
	}
	if len(choices) == 0 {
		for _, s := range articleSites["ai"] {
			choices = append(choices, choice{s, "ai"})
		}
	}
	c := choices[intn(len(choices))]
	return Article{Name: c.Name, URL: c.URL, Tech: techName[c.tech]}
}

// GuideArticle suggests a blog for the technologies in a workspace's
// folders, for the office guide. An empty id means no workspace is selected.
func (a *App) GuideArticle(workspaceID string) (Article, error) {
	var folders, topics []string
	if workspaceID != "" {
		if err := a.unlocked(); err != nil {
			return Article{}, err
		}
		ws, err := a.loadWorkspace(workspaceID)
		if err != nil {
			return Article{}, err
		}
		folders, topics = ws.Folders, guideTopics(ws.Topics)
	}
	// Topics the user chose come first; otherwise what the folders contain.
	if len(topics) == 0 {
		topics = detectTech(folders)
	}
	return pickArticle(topics, rand.IntN), nil
}
