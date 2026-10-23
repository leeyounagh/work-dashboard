package term

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeProcess echoes writes back as output and exits when closed.
type fakeProcess struct {
	mu      sync.Mutex
	out     chan []byte
	written bytes.Buffer
	cols    int
	rows    int
	closed  chan struct{}
	once    sync.Once
}

func newFakeProcess() *fakeProcess {
	return &fakeProcess{out: make(chan []byte, 16), closed: make(chan struct{})}
}

func (f *fakeProcess) Read(p []byte) (int, error) {
	select {
	case b := <-f.out:
		return copy(p, b), nil
	case <-f.closed:
		return 0, io.EOF
	}
}

func (f *fakeProcess) Write(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.written.Write(p)
	return len(p), nil
}

func (f *fakeProcess) Resize(cols, rows int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cols, f.rows = cols, rows
	return nil
}

func (f *fakeProcess) Close() error {
	f.once.Do(func() { close(f.closed) })
	return nil
}

func (f *fakeProcess) Wait() error {
	<-f.closed
	return nil
}

type recorder struct {
	mu    sync.Mutex
	data  map[string]*bytes.Buffer
	exits chan string
}

func newRecorder() *recorder {
	return &recorder{data: map[string]*bytes.Buffer{}, exits: make(chan string, 8)}
}

func (r *recorder) onData(id string, b []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.data[id] == nil {
		r.data[id] = &bytes.Buffer{}
	}
	r.data[id].Write(b)
}

func (r *recorder) onExit(id string, _ error) { r.exits <- id }

func (r *recorder) output(id string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.data[id] == nil {
		return ""
	}
	return r.data[id].String()
}

func newTestManager(t *testing.T) (*Manager, *recorder, *[]*fakeProcess, *[]Spec) {
	t.Helper()
	rec := newRecorder()
	var procs []*fakeProcess
	var specs []Spec
	var mu sync.Mutex
	start := func(spec Spec, cols, rows int) (Process, error) {
		mu.Lock()
		defer mu.Unlock()
		p := newFakeProcess()
		_ = p.Resize(cols, rows)
		procs = append(procs, p)
		specs = append(specs, spec)
		return p, nil
	}
	m := NewManager(start, rec.onData, rec.onExit)
	t.Cleanup(m.CloseAll)
	return m, rec, &procs, &specs
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestOpenStreamsOutput(t *testing.T) {
	m, rec, procs, specs := newTestManager(t)
	info, err := m.Open(Spec{Name: "claude", Title: "Claude", Dir: `C:\work`}, 120, 30)
	if err != nil {
		t.Fatal(err)
	}
	if info.ID == "" || info.Title != "Claude" || info.Dir != `C:\work` {
		t.Fatalf("Info = %+v", info)
	}
	if (*specs)[0].Name != "claude" {
		t.Fatalf("spec not passed to starter: %+v", (*specs)[0])
	}
	if (*procs)[0].cols != 120 || (*procs)[0].rows != 30 {
		t.Fatalf("initial size not applied")
	}

	(*procs)[0].out <- []byte("hello")
	waitFor(t, func() bool { return rec.output(info.ID) == "hello" })
}

func TestWriteResizeClose(t *testing.T) {
	m, rec, procs, _ := newTestManager(t)
	info, err := m.Open(Spec{Name: "sh"}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Write(info.ID, "ls\r"); err != nil {
		t.Fatal(err)
	}
	if got := (*procs)[0].written.String(); got != "ls\r" {
		t.Fatalf("written = %q", got)
	}
	if err := m.Resize(info.ID, 100, 40); err != nil {
		t.Fatal(err)
	}
	if (*procs)[0].cols != 100 || (*procs)[0].rows != 40 {
		t.Fatal("resize not applied")
	}
	if err := m.Close(info.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case id := <-rec.exits:
		if id != info.ID {
			t.Fatalf("exit for %q, want %q", id, info.ID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no exit event")
	}
	waitFor(t, func() bool { return len(m.List()) == 0 })
}

func TestUnknownSession(t *testing.T) {
	m, _, _, _ := newTestManager(t)
	for name, err := range map[string]error{
		"write":  m.Write("nope", "x"),
		"resize": m.Resize("nope", 1, 1),
		"close":  m.Close("nope"),
	} {
		if !errors.Is(err, ErrNoSession) {
			t.Errorf("%s: err = %v, want ErrNoSession", name, err)
		}
	}
}

func TestResizeRejectsBadSize(t *testing.T) {
	m, _, _, _ := newTestManager(t)
	if _, err := m.Open(Spec{Name: "sh"}, 0, 24); err == nil {
		t.Fatal("expected error for zero columns")
	}
	info, err := m.Open(Spec{Name: "sh"}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Resize(info.ID, 80, -1); err == nil {
		t.Fatal("expected error for negative rows")
	}
}

func TestStartFailure(t *testing.T) {
	m := NewManager(func(Spec, int, int) (Process, error) {
		return nil, errors.New("no such file")
	}, func(string, []byte) {}, func(string, error) {})
	_, err := m.Open(Spec{Name: "missing"}, 80, 24)
	if err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("err = %v, want it to name the command", err)
	}
	if len(m.List()) != 0 {
		t.Fatal("failed start must not register a session")
	}
}

func TestListIsSortedByOpenOrder(t *testing.T) {
	m, _, _, _ := newTestManager(t)
	a, _ := m.Open(Spec{Name: "a", Title: "A"}, 80, 24)
	b, _ := m.Open(Spec{Name: "b", Title: "B"}, 80, 24)
	list := m.List()
	if len(list) != 2 || list[0].ID != a.ID || list[1].ID != b.ID {
		t.Fatalf("List() = %+v", list)
	}
}

func TestCloseAll(t *testing.T) {
	m, rec, _, _ := newTestManager(t)
	for range 3 {
		if _, err := m.Open(Spec{Name: "sh"}, 80, 24); err != nil {
			t.Fatal(err)
		}
	}
	m.CloseAll()
	for range 3 {
		select {
		case <-rec.exits:
		case <-time.After(2 * time.Second):
			t.Fatal("missing exit event")
		}
	}
}

func TestCloseOnRequestReportsNoError(t *testing.T) {
	errs := make(chan error, 1)
	start := func(Spec, int, int) (Process, error) {
		return &failingWait{fakeProcess: newFakeProcess()}, nil
	}
	m := NewManager(start, func(string, []byte) {}, func(_ string, err error) { errs <- err })
	info, err := m.Open(Spec{Name: "sh"}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Close(info.ID); err != nil {
		t.Fatal(err)
	}
	if err := <-errs; err != nil {
		t.Fatalf("closing on request reported %v", err)
	}
}

func TestNaturalExitErrorIsReported(t *testing.T) {
	errs := make(chan error, 1)
	var proc *failingWait
	start := func(Spec, int, int) (Process, error) {
		proc = &failingWait{fakeProcess: newFakeProcess()}
		return proc, nil
	}
	m := NewManager(start, func(string, []byte) {}, func(_ string, err error) { errs <- err })
	if _, err := m.Open(Spec{Name: "sh"}, 80, 24); err != nil {
		t.Fatal(err)
	}
	_ = proc.fakeProcess.Close() // the process ends by itself
	if err := <-errs; err == nil {
		t.Fatal("a natural non-zero exit should be reported")
	}
}

func TestOpenAfterCloseAllIsRefused(t *testing.T) {
	m, _, procs, _ := newTestManager(t)
	m.CloseAll()
	if _, err := m.Open(Spec{Name: "sh"}, 80, 24); err == nil {
		t.Fatal("Open after shutdown must fail")
	}
	for _, p := range *procs {
		select {
		case <-p.closed:
		default:
			t.Fatal("a process started during shutdown must be closed")
		}
	}
}

type failingWait struct{ *fakeProcess }

func (f *failingWait) Wait() error {
	_ = f.fakeProcess.Wait()
	return errors.New("exit status 1")
}
