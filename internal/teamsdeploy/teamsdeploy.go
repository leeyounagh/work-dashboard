// Package teamsdeploy turns deploy notification cards posted in a Teams chat
// (read through the Microsoft 365 connector) into a small, filterable feed.
// Cards already read are kept on disk, so each refresh only reads new ones.
package teamsdeploy

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Backfill is how far back the first read of a chat goes.
const Backfill = 24 * time.Hour

// Keep is how long cards stay in the store.
const Keep = 7 * 24 * time.Hour

// Overlap: each read goes back this far before the newest stored card, so
// cards posted together (or missed once) are still picked up; stored ones
// are skipped by id.
const Overlap = 10 * time.Minute

// maxFuture is how far ahead of now a card's time may be (clock skew); later
// times are wrong and would push the next read past every new card.
const maxFuture = 5 * time.Minute

var (
	chatIDPattern = regexp.MustCompile(`19:[0-9A-Za-z_-]+@(thread\.v2|thread\.tacv2|unq\.gbl\.spaces)`)
	messageID     = regexp.MustCompile(`^[0-9]{1,20}$`)
	repoPattern   = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	// "✅ [groupware-frontend] TEST · PR #1966 배포 완료"
	titlePattern = regexp.MustCompile(`^\s*(\S+)\s*\[([A-Za-z0-9_.-]+)\]\s*([A-Za-z]+)\b`)
	tagPattern   = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,40}$`)
)

// ChatID finds the chat id in a Teams chat link ("Copy link") or takes the id itself.
func ChatID(s string) (string, error) {
	decoded, err := url.PathUnescape(strings.TrimSpace(s))
	if err != nil {
		decoded = s
	}
	id := chatIDPattern.FindString(decoded)
	if id == "" {
		return "", errors.New("Teams 채팅방 링크(또는 19:…@thread.v2 형식의 ID)가 아닙니다")
	}
	return id, nil
}

// CheckTags rejects tags that could not be a card's [tag].
func CheckTags(tags []string) error {
	for _, t := range tags {
		if !tagPattern.MatchString(t) {
			return fmt.Errorf("서비스 태그 %q 는 쓸 수 없습니다 (영문·숫자·-·_ 만)", t)
		}
	}
	return nil
}

// RawPR and Raw are what Claude reports for one card.
type RawPR struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	Author string `json:"author"`
	Shared bool   `json:"shared"`
}

type Raw struct {
	ID        string  `json:"id"`
	CreatedAt string  `json:"createdAt"`
	WebURL    string  `json:"webUrl"`
	Title     string  `json:"title"`
	Repo      string  `json:"repo"`
	Image     string  `json:"image"`
	PRs       []RawPR `json:"prs"`
}

// PR is one pull request listed on a card.
type PR struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	Author string `json:"author"`
	URL    string `json:"url"`
	// Shared: redeployed only because shared code changed; another service's work.
	Shared bool `json:"shared"`
}

// Card is one deploy notification.
type Card struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	WebURL    string    `json:"webUrl"`
	Status    string    `json:"status"` // the leading emoji, e.g. ✅
	Tag       string    `json:"tag"`    // service, e.g. groupware-frontend
	Env       string    `json:"env"`    // TEST, PROD
	Title     string    `json:"title"`
	Repo      string    `json:"repo"`
	Image     string    `json:"image"`
	PRs       []PR      `json:"prs"`
}

// FromRaw checks what Claude reported; cards that do not look like a deploy
// notification, or claim to come from the future, are dropped.
func FromRaw(r Raw, now time.Time) (Card, bool) {
	m := titlePattern.FindStringSubmatch(r.Title)
	at, err := time.Parse(time.RFC3339Nano, r.CreatedAt)
	if m == nil || err != nil || !messageID.MatchString(r.ID) || at.After(now.Add(maxFuture)) {
		return Card{}, false
	}
	c := Card{
		ID: r.ID, CreatedAt: at.UTC(), Status: m[1], Tag: m[2], Env: strings.ToUpper(m[3]),
		Title: strings.TrimSpace(r.Title), Image: strings.Trim(strings.TrimSpace(r.Image), "`"), PRs: []PR{},
	}
	if strings.HasPrefix(r.WebURL, "https://teams.microsoft.com/") {
		c.WebURL = r.WebURL
	}
	if repoPattern.MatchString(r.Repo) {
		c.Repo = r.Repo
	}
	for _, p := range r.PRs {
		if p.Number <= 0 {
			continue
		}
		pr := PR{Number: p.Number, Title: strings.TrimSpace(p.Title), Author: strings.TrimSpace(p.Author), Shared: p.Shared}
		if c.Repo != "" {
			pr.URL = fmt.Sprintf("https://github.com/%s/pull/%d", c.Repo, p.Number)
		}
		c.PRs = append(c.PRs, pr)
	}
	return c, true
}

// Store is the cards read so far from one chat, newest first.
type Store struct {
	Cards []Card `json:"cards"`
}

// Load reads a store; a missing file is an empty store.
func Load(path string) (Store, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Store{Cards: []Card{}}, nil
	}
	if err != nil {
		return Store{Cards: []Card{}}, err
	}
	var s Store
	if err := json.Unmarshal(b, &s); err != nil {
		return Store{Cards: []Card{}}, fmt.Errorf("teams 알림 저장 파일이 깨졌습니다: %w", err)
	}
	if s.Cards == nil {
		s.Cards = []Card{}
	}
	return s, nil
}

// Save writes the store atomically.
func (s Store) Save(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Since is where the next read starts: Overlap before the newest card, but
// never further back than Backfill.
func (s Store) Since(now time.Time) time.Time {
	since := now.Add(-Backfill)
	if len(s.Cards) > 0 && s.Cards[0].CreatedAt.Add(-Overlap).After(since) {
		since = s.Cards[0].CreatedAt.Add(-Overlap)
	}
	return since
}

// Known lists the stored cards at or after since, which a read can skip.
func (s Store) Known(since time.Time) []string {
	var ids []string
	for _, c := range s.Cards {
		if !c.CreatedAt.Before(since) {
			ids = append(ids, c.ID)
		}
	}
	return ids
}

// Merge returns a new store with the cards added (a card read again replaces
// the old copy), newest first, without cards older than Keep.
func (s Store) Merge(cards []Card, now time.Time) Store {
	byID := map[string]Card{}
	for _, c := range s.Cards {
		byID[c.ID] = c
	}
	for _, c := range cards {
		byID[c.ID] = c
	}
	out := make([]Card, 0, len(byID))
	for _, c := range byID {
		if now.Sub(c.CreatedAt) <= Keep {
			out = append(out, c)
		}
	}
	slices.SortFunc(out, func(a, b Card) int { return b.CreatedAt.Compare(a.CreatedAt) })
	return Store{Cards: out}
}

// Filter keeps the cards of the given services (all when tags is empty), at most limit.
func Filter(cards []Card, tags []string, limit int) []Card {
	out := []Card{}
	for _, c := range cards {
		if len(out) >= limit {
			break
		}
		if len(tags) == 0 || slices.ContainsFunc(tags, func(t string) bool { return strings.EqualFold(t, c.Tag) }) {
			out = append(out, c)
		}
	}
	return out
}
