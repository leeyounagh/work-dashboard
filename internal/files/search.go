package files

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
)

// skipDirs are never searched: dependency, build and VCS folders are huge and
// rarely what the user looks for (.worktrees are duplicates of the repo).
var skipDirs = map[string]bool{
	".git": true, "node_modules": true, ".next": true, "dist": true, "build": true,
	".worktrees": true, "vendor": true, ".turbo": true, "coverage": true, ".cache": true,
	"bin": true, "obj": true, ".dart_tool": true, ".gradle": true, "__pycache__": true,
}

// SearchResult holds matches; Truncated means the limit or deadline was hit.
type SearchResult struct {
	Entries   []Entry `json:"entries"`
	Truncated bool    `json:"truncated"`
}

var errStop = errors.New("stop")

// Search finds files whose path (relative to its root) contains query,
// ignoring case. Name matches are listed before path-only matches.
func Search(ctx context.Context, g Guard, roots []string, query string, limit int) (SearchResult, error) {
	q := strings.ToLower(strings.TrimSpace(filepath.ToSlash(query)))
	if q == "" {
		return SearchResult{}, errors.New("검색어를 입력하세요")
	}
	type hit struct {
		e        Entry
		nameHit  bool
		relDepth int
	}
	var hits []hit
	res := SearchResult{Entries: []Entry{}}
	for _, root := range roots {
		if _, err := g.Resolve(root); err != nil {
			continue
		}
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil // unreadable folder: skip it
			}
			if ctx.Err() != nil {
				return errStop
			}
			if d.IsDir() {
				if path != root && (skipDirs[d.Name()] || hidden[d.Name()]) {
					return fs.SkipDir
				}
				return nil
			}
			// Symlinks are not followed: they could lead outside the workspace.
			if d.Type()&fs.ModeSymlink != 0 {
				return nil
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return nil
			}
			relSlash := strings.ToLower(filepath.ToSlash(rel))
			if !strings.Contains(relSlash, q) {
				return nil
			}
			hits = append(hits, hit{
				e:        Entry{Name: d.Name(), Path: path},
				nameHit:  strings.Contains(strings.ToLower(d.Name()), q),
				relDepth: strings.Count(relSlash, "/"),
			})
			if len(hits) >= limit {
				return errStop
			}
			return nil
		})
		if errors.Is(err, errStop) {
			res.Truncated = true
			break
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].nameHit != hits[j].nameHit {
			return hits[i].nameHit
		}
		return hits[i].relDepth < hits[j].relDepth
	})
	for _, h := range hits {
		res.Entries = append(res.Entries, h.e)
	}
	return res, nil
}
