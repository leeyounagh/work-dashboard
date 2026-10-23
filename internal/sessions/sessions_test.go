package sessions

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)

func TestLifecycle(t *testing.T) {
	s := NewStore(filepath.Join(t.TempDir(), "sub", "sessions.json"))
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(s.Started(Record{SessionID: "a", WorkspaceID: "gw", StartedAt: t0, LastActive: t0}))
	must(s.Started(Record{SessionID: "b", WorkspaceID: "gw", StartedAt: t0, LastActive: t0}))
	must(s.Started(Record{SessionID: "c", WorkspaceID: "other", StartedAt: t0, LastActive: t0}))

	// Sessions without a prompt cannot be resumed and are not listed.
	recent, err := s.Recent("gw", 10)
	if err != nil || len(recent) != 0 {
		t.Fatalf("Recent before prompts = %+v, %v", recent, err)
	}

	must(s.Touch("a", "휴가 신청 화면 버그 고쳐줘", t0.Add(time.Minute)))
	must(s.Touch("a", "second prompt does not replace the title", t0.Add(2*time.Minute)))
	must(s.Touch("b", strings.Repeat("가", 200), t0.Add(3*time.Minute)))
	must(s.Touch("missing", "x", t0)) // unknown ids are ignored

	recent, err = s.Recent("gw", 10)
	if err != nil || len(recent) != 2 || recent[0].SessionID != "b" || recent[1].Title != "휴가 신청 화면 버그 고쳐줘" {
		t.Fatalf("Recent = %+v, %v", recent, err)
	}
	if n := len([]rune(recent[0].Title)); n != maxTitle {
		t.Fatalf("title length = %d", n)
	}
	if got, _ := s.Recent("gw", 1); len(got) != 1 {
		t.Fatal("limit not applied")
	}

	// b closes normally; a is still open when the app exits.
	must(s.Closed("b"))
	open, err := s.TakeOpenAtExit()
	if err != nil || len(open) != 1 || open[0].SessionID != "a" {
		t.Fatalf("TakeOpenAtExit = %+v, %v", open, err)
	}
	// Taken once: the next start has nothing to restore.
	if again, _ := s.TakeOpenAtExit(); len(again) != 0 {
		t.Fatalf("second take = %+v", again)
	}

	// Resuming marks it open again.
	must(s.Started(Record{SessionID: "a", WorkspaceID: "gw", LastActive: t0.Add(time.Hour)}))
	r, ok, err := s.Get("a")
	if err != nil || !ok || !r.Open || r.Title == "" {
		t.Fatalf("Get = %+v, %v, %v", r, ok, err)
	}
	if _, ok, _ := s.Get("zzz"); ok {
		t.Fatal("unknown id found")
	}
}

func TestCapAndCorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	s := NewStore(path)
	for i := range maxRecords + 5 {
		if err := s.Started(Record{SessionID: string(rune('A'+i%26)) + time.Duration(i).String(), LastActive: t0.Add(time.Duration(i) * time.Second)}); err != nil {
			t.Fatal(err)
		}
	}
	recs, err := s.load()
	if err != nil || len(recs) != maxRecords {
		t.Fatalf("records = %d, %v", len(recs), err)
	}
	if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Recent("x", 1); err == nil {
		t.Fatal("corrupt file must error")
	}
	if open, err := NewStore(filepath.Join(t.TempDir(), "none.json")).TakeOpenAtExit(); err != nil || open != nil {
		t.Fatalf("empty store = %v, %v", open, err)
	}
}
