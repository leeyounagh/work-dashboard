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

func TestValidID(t *testing.T) {
	for _, ok := range []string{"2de3e295-5032-4f1a-bdcc-36f7f1188772", "sess-1"} {
		if !ValidID(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"", "--dangerously-skip-permissions", "-x", `..\x`, "a b", strings.Repeat("a", 65)} {
		if ValidID(bad) {
			t.Errorf("%q should be invalid", bad)
		}
	}
}

func TestLoadDropsInvalidIDs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.json")
	data := `[{"sessionId":"--resume","workspaceId":"w","title":"x","open":true},{"sessionId":"good","workspaceId":"w","title":"t","open":true}]`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	open, err := NewStore(path).TakeOpenAtExit()
	if err != nil || len(open) != 1 || open[0].SessionID != "good" {
		t.Fatalf("open = %+v, %v", open, err)
	}
}

func TestRenameKeepsNameOverPrompt(t *testing.T) {
	s := NewStore(filepath.Join(t.TempDir(), "s.json"))
	if err := s.Started(Record{SessionID: "a", WorkspaceID: "w", LastActive: t0}); err != nil {
		t.Fatal(err)
	}
	if err := s.Rename("a", "휴가 기능"); err != nil {
		t.Fatal(err)
	}
	// A later first prompt must not replace a name the user chose.
	if err := s.Touch("a", "prompt text", t0.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	r, _, _ := s.Get("a")
	if r.Title != "휴가 기능" {
		t.Fatalf("title = %q", r.Title)
	}
}
