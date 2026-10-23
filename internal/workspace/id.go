package workspace

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"
)

// NewID derives a file-safe workspace ID from a display name, unique among existing.
// Names with no ASCII letters or digits get a random "ws-xxxxxx" ID.
func NewID(name string, existing []string) string {
	base := slug(name)
	if base == "" || reservedID.MatchString(base) {
		for {
			if id := "ws-" + randomHex(3); !slices.Contains(existing, id) {
				return id
			}
		}
	}
	id := base
	for n := 2; slices.Contains(existing, id); n++ {
		id = fmt.Sprintf("%s-%d", base, n)
	}
	return id
}

func slug(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		case b.Len() > 0 && !dash:
			b.WriteByte('-')
			dash = true
		}
	}
	s := strings.TrimSuffix(b.String(), "-")
	if len(s) > 56 { // leave room for a "-N" suffix within the 64-char limit
		s = strings.TrimSuffix(s[:56], "-")
	}
	return s
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b) // crypto/rand.Read never fails on supported platforms
	return hex.EncodeToString(b)
}
