package tokens

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func assistant(id string, in, cacheWrite, cacheRead, out int) string {
	return `{"type":"assistant","message":{"id":"` + id + `","usage":{"input_tokens":` + strconv.Itoa(in) +
		`,"cache_creation_input_tokens":` + strconv.Itoa(cacheWrite) + `,"cache_read_input_tokens":` + strconv.Itoa(cacheRead) +
		`,"output_tokens":` + strconv.Itoa(out) + `}}}` + "\n"
}

func appendTo(t *testing.T, path, text string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(text); err != nil {
		t.Fatal(err)
	}
}

func TestReaderCountsNewAssistantUsageOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	// One message split over two lines (text + tool_use) repeats its usage.
	appendTo(t, path, `{"type":"user","message":{"content":"hi"}}`+"\n"+
		assistant("m1", 2, 100, 5000, 30)+assistant("m1", 2, 100, 5000, 30))
	var r Reader
	got, err := r.Read(path)
	if err != nil || got != 132 {
		t.Fatalf("first read = %d, %v; want 132 (cache reads left out, m1 once)", got, err)
	}

	// Only what was appended since; a half-written line waits for its end.
	partial := assistant("m2", 1, 0, 0, 9)
	appendTo(t, path, assistant("m1", 2, 100, 5000, 30)+partial[:20])
	if got, _ := r.Read(path); got != 0 {
		t.Fatalf("second read = %d, want 0", got)
	}
	appendTo(t, path, partial[20:])
	if got, _ := r.Read(path); got != 10 {
		t.Fatalf("third read = %d, want 10", got)
	}
}

func TestReaderMissingFileIsZero(t *testing.T) {
	var r Reader
	got, err := r.Read(filepath.Join(t.TempDir(), "none.jsonl"))
	if err != nil || got != 0 {
		t.Fatalf("Read = %d, %v", got, err)
	}
}

func TestReaderStartsOverWhenTheFileShrinks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendTo(t, path, assistant("m1", 1, 0, 0, 1)+assistant("m2", 1, 0, 0, 1))
	var r Reader
	r.Read(path)
	if err := os.WriteFile(path, []byte(assistant("m3", 4, 0, 0, 4)), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.Read(path); got != 8 {
		t.Fatalf("after rewrite = %d, want 8", got)
	}
}

func day(s string) time.Time {
	d, _ := time.ParseInLocation("2006-01-02 15:04", s, time.Local)
	return d
}

func TestLedgerTodayWeekAndPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tokens.json")
	now := day("2026-10-20 10:00")
	l := OpenLedger(path, func() time.Time { return now })
	if _, err := l.Add(100); err != nil {
		t.Fatal(err)
	}
	now = day("2026-10-26 09:00")
	l.Add(20)
	now = day("2026-10-27 23:00")
	got, _ := l.Add(3)
	// The 20th is 7 days before the 27th: out of the week.
	if got.Today != 3 || got.Week != 23 {
		t.Fatalf("totals = %+v", got)
	}

	again := OpenLedger(path, func() time.Time { return now })
	if tot := again.Totals(); tot != got {
		t.Fatalf("reloaded totals = %+v, want %+v", tot, got)
	}
}

func TestLedgerForgetsOldDaysAndIgnoresBadFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tokens.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	now := day("2026-10-01 12:00")
	l := OpenLedger(path, func() time.Time { return now })
	l.Add(5)
	now = day("2026-10-27 12:00")
	l.Add(1)
	if n := len(l.days); n != 1 {
		t.Fatalf("kept %d days, want only recent ones", n)
	}
}

func TestSkipToEndCountsOnlyWhatComesAfter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	var r Reader
	if exists, err := r.SkipToEnd(path); exists || err != nil {
		t.Fatalf("missing file: exists=%v err=%v", exists, err)
	}
	// History, then a half-written line that must still be read later.
	next := assistant("m2", 1, 0, 0, 2)
	appendTo(t, path, assistant("m1", 500, 0, 0, 500)+next[:15])
	if exists, err := r.SkipToEnd(path); !exists || err != nil {
		t.Fatalf("SkipToEnd = %v, %v", exists, err)
	}
	appendTo(t, path, next[15:])
	if got, _ := r.Read(path); got != 3 {
		t.Fatalf("after skip = %d, want 3", got)
	}
}
