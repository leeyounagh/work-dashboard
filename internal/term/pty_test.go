package term

import (
	"io"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestStartPTYRunsRealCommand starts a real process through the platform PTY.
func TestStartPTYRunsRealCommand(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a real process")
	}
	spec := Spec{Name: "sh", Args: []string{"-c", "echo pty-ok"}, Dir: t.TempDir()}
	if runtime.GOOS == "windows" {
		spec = Spec{Name: "cmd.exe", Args: []string{"/d", "/c", "echo pty-ok"}, Dir: t.TempDir()}
	}

	var mu sync.Mutex
	var out strings.Builder
	exited := make(chan struct{})
	m := NewManager(StartPTY, func(_ string, b []byte) {
		mu.Lock()
		defer mu.Unlock()
		out.Write(b)
	}, func(string, error) { close(exited) })
	t.Cleanup(m.CloseAll)

	if _, err := m.Open(spec, 80, 24); err != nil {
		t.Fatal(err)
	}
	select {
	case <-exited:
	case <-time.After(10 * time.Second):
		t.Fatal("process did not exit")
	}
	mu.Lock()
	defer mu.Unlock()
	if !strings.Contains(out.String(), "pty-ok") {
		t.Fatalf("output = %q", out.String())
	}
}

func TestStartPTYUnknownCommand(t *testing.T) {
	if _, err := StartPTY(Spec{Name: "definitely-not-a-command-xyz"}, 80, 24); err == nil {
		t.Fatal("expected error")
	}
}

// TestPTYResizeAfterExitIsSafe guards against reaching a freed ConPTY handle.
func TestPTYResizeAfterExitIsSafe(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a real process")
	}
	spec := Spec{Name: "sh", Args: []string{"-c", "exit 0"}}
	if runtime.GOOS == "windows" {
		spec = Spec{Name: "cmd.exe", Args: []string{"/d", "/c", "exit 0"}}
	}
	proc, err := StartPTY(spec, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	go func() { _, _ = io.Copy(io.Discard, proc) }()
	_ = proc.Wait()
	_ = proc.Close()
	if err := proc.Resize(100, 30); err == nil {
		t.Fatal("Resize after close must fail instead of touching the closed pty")
	}
	if _, err := proc.Write([]byte("x")); err == nil {
		t.Fatal("Write after close must fail")
	}
}

// TestPTYKeepsOutputJustBeforeExit checks the tail of the output is not cut off.
func TestPTYKeepsOutputJustBeforeExit(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a real process")
	}
	spec := Spec{Name: "sh", Args: []string{"-c", "i=0; while [ $i -lt 200 ]; do echo line$i; i=$((i+1)); done; echo TAIL-OK"}}
	if runtime.GOOS == "windows" {
		spec = Spec{Name: "cmd.exe", Args: []string{"/d", "/c", "for /l %i in (1,1,200) do @echo line%i & echo TAIL-OK"}}
	}
	for attempt := 0; attempt < 5; attempt++ {
		var mu sync.Mutex
		var out strings.Builder
		exited := make(chan struct{})
		m := NewManager(StartPTY, func(_ string, b []byte) {
			time.Sleep(time.Millisecond) // a slow consumer, like EventsEmit
			mu.Lock()
			out.Write(b)
			mu.Unlock()
		}, func(string, error) { close(exited) })
		if _, err := m.Open(spec, 200, 50); err != nil {
			t.Fatal(err)
		}
		select {
		case <-exited:
		case <-time.After(15 * time.Second):
			t.Fatal("process did not exit")
		}
		mu.Lock()
		got := out.String()
		mu.Unlock()
		if !strings.Contains(got, "TAIL-OK") {
			t.Fatalf("attempt %d: tail lost; got %d bytes", attempt, len(got))
		}
	}
}
