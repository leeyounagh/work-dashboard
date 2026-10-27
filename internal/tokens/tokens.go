// Package tokens counts the tokens Claude sessions use, read from their
// transcripts, and keeps daily totals for the office.
//
// Counted: input, cache writes and output. Cache reads are left out: every
// turn re-reads the whole conversation, so they would dwarf the work done.
package tokens

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"github.com/leeyounagh/work-dashboard/internal/fsutil"
)

// maxRead caps one read of a transcript; the rest is read next time.
const maxRead = 64 << 20

// Reader reads a transcript (JSONL) incrementally. The zero value is ready.
type Reader struct {
	offset int64
	seen   map[string]struct{} // message IDs already counted
}

type line struct {
	Type    string `json:"type"`
	Message struct {
		ID    string `json:"id"`
		Usage *struct {
			Input      int64 `json:"input_tokens"`
			CacheWrite int64 `json:"cache_creation_input_tokens"`
			Output     int64 `json:"output_tokens"`
		} `json:"usage"`
	} `json:"message"`
}

var usageKey = []byte(`"usage"`)

// Read returns the tokens of assistant messages appended since the last
// read. A missing file counts as empty; a half-written last line waits.
func (r *Reader) Read(path string) (int64, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return 0, err
	}
	if info.Size() < r.offset {
		r.offset = 0 // rewritten; message IDs still guard against double counts
	}
	if _, err := f.Seek(r.offset, io.SeekStart); err != nil {
		return 0, err
	}
	data, err := io.ReadAll(io.LimitReader(f, maxRead))
	if err != nil {
		return 0, err
	}
	end := bytes.LastIndexByte(data, '\n')
	if end < 0 {
		if len(data) == maxRead {
			r.offset += maxRead // one huge line (an image): skip it, never stall on it
		}
		return 0, nil
	}
	if r.seen == nil {
		r.seen = map[string]struct{}{}
	}
	var total int64
	for raw := range bytes.SplitSeq(data[:end], []byte{'\n'}) {
		if !bytes.Contains(raw, usageKey) {
			continue
		}
		var l line
		if json.Unmarshal(raw, &l) != nil || l.Type != "assistant" || l.Message.Usage == nil {
			continue
		}
		// A message is written once per content block with the same usage;
		// the first line counts.
		if _, dup := r.seen[l.Message.ID]; dup && l.Message.ID != "" {
			continue
		}
		r.seen[l.Message.ID] = struct{}{}
		u := l.Message.Usage
		total += u.Input + u.CacheWrite + u.Output
	}
	r.offset += int64(end) + 1
	return total, nil
}

// tailWindow is how far back from the end SkipToEnd looks for a line break.
const tailWindow = 1 << 20

// SkipToEnd moves past everything already in the file without parsing it,
// so earlier history is never counted. It reports whether the file exists.
func (r *Reader) SkipToEnd(path string) (bool, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return true, err
	}
	// Stop after the last complete line; a half-written one is read later.
	start := max(0, info.Size()-tailWindow)
	tail := make([]byte, info.Size()-start)
	if _, err := f.ReadAt(tail, start); err != nil && !errors.Is(err, io.EOF) {
		return true, err
	}
	r.offset = info.Size()
	if i := bytes.LastIndexByte(tail, '\n'); i >= 0 {
		r.offset = start + int64(i) + 1
	}
	return true, nil
}

// Totals are the tokens used today and over the last seven days.
type Totals struct {
	Today int64 `json:"today"`
	Week  int64 `json:"week"`
}

// keepDays is how many days of history the ledger file keeps.
const keepDays = 14

const dayLayout = "2006-01-02"

// Ledger keeps per-day token totals in a small JSON file.
type Ledger struct {
	mu   sync.Mutex
	path string
	now  func() time.Time
	days map[string]int64
}

type ledgerFile struct {
	Days map[string]int64 `json:"days"`
}

// OpenLedger loads the ledger at path. A missing or unreadable file starts
// empty: the totals are for fun and must never stop the app.
func OpenLedger(path string, now func() time.Time) *Ledger {
	if now == nil {
		now = time.Now
	}
	l := &Ledger{path: path, now: now, days: map[string]int64{}}
	if data, err := os.ReadFile(path); err == nil {
		var f ledgerFile
		if json.Unmarshal(data, &f) == nil && f.Days != nil {
			l.days = f.Days
		}
	}
	return l
}

// Add records n tokens for today and returns the new totals.
func (l *Ledger) Add(n int64) (Totals, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if n > 0 {
		l.days[now.Format(dayLayout)] += n
	}
	oldest := now.AddDate(0, 0, -keepDays).Format(dayLayout)
	for d := range l.days {
		if d < oldest {
			delete(l.days, d)
		}
	}
	data, err := json.Marshal(ledgerFile{Days: l.days})
	if err == nil {
		err = fsutil.WriteFileAtomic(l.path, data)
	}
	if err != nil {
		err = fmt.Errorf("토큰 기록을 저장하지 못했습니다: %w", err)
	}
	return l.totals(now), err
}

// Totals returns today's and this week's totals.
func (l *Ledger) Totals() Totals {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.totals(l.now())
}

func (l *Ledger) totals(now time.Time) Totals {
	t := Totals{Today: l.days[now.Format(dayLayout)]}
	for i := range 7 {
		t.Week += l.days[now.AddDate(0, 0, -i).Format(dayLayout)]
	}
	return t
}
