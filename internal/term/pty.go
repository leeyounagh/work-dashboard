package term

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	pty "github.com/aymanbagabas/go-pty"
)

// After the process exits, ConPTY keeps the output pipe open until the
// pseudo-console is closed. We close it once output has gone quiet, so the
// last lines (often an error message) are still delivered.
const (
	drainQuiet = 150 * time.Millisecond
	drainMax   = 2 * time.Second
)

type ptyProcess struct {
	pty pty.Pty
	cmd *pty.Cmd

	done     chan struct{} // closed when the process has exited
	waitErr  error
	lastRead atomic.Int64 // unix nanos of the last successful Read

	mu     sync.Mutex // guards closed and every call into the pty handle
	closed bool
}

func (p *ptyProcess) Read(b []byte) (int, error) {
	n, err := p.pty.Read(b)
	if n > 0 {
		p.lastRead.Store(time.Now().UnixNano())
	}
	return n, err
}

// Write and Resize hold the lock so they never reach a closed (freed) ConPTY handle.
func (p *ptyProcess) Write(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return 0, os.ErrClosed
	}
	return p.pty.Write(b)
}

func (p *ptyProcess) Resize(cols, rows int) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return os.ErrClosed
	}
	return p.pty.Resize(cols, rows)
}

// Wait blocks until the process has exited.
func (p *ptyProcess) Wait() error {
	<-p.done
	return p.waitErr
}

func (p *ptyProcess) closePty() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil
	}
	p.closed = true
	return p.pty.Close()
}

// watch waits for the process, lets remaining output drain, then closes the
// pty so the reader sees EOF.
func (p *ptyProcess) watch() {
	p.waitErr = p.cmd.Wait()
	close(p.done)
	deadline := time.Now().Add(drainMax)
	for time.Now().Before(deadline) {
		if time.Since(time.Unix(0, p.lastRead.Load())) >= drainQuiet {
			break
		}
		time.Sleep(drainQuiet / 3)
	}
	_ = p.closePty()
}

// Close kills the process and releases the pseudo-terminal.
func (p *ptyProcess) Close() error {
	select {
	case <-p.done:
		return p.closePty()
	default:
	}
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	return p.closePty()
}

// StartPTY is the real Starter: ConPTY on Windows, a pty on Unix.
func StartPTY(spec Spec, cols, rows int) (Process, error) {
	// go-pty joins a relative executable with Dir on Windows, so resolve it first.
	exe, err := exec.LookPath(spec.Name)
	if err != nil {
		return nil, fmt.Errorf("실행 파일을 찾지 못했습니다: %w", err)
	}
	p, err := pty.New()
	if err != nil {
		return nil, fmt.Errorf("터미널을 만들지 못했습니다: %w", err)
	}
	// Nothing reads the output on these error paths, and closing a ConPTY can
	// wait for it to flush, so close it in the background.
	discard := func() { go func() { _ = p.Close() }() }
	if err := p.Resize(cols, rows); err != nil {
		discard()
		return nil, fmt.Errorf("터미널 크기를 정하지 못했습니다: %w", err)
	}
	cmd := p.Command(exe, spec.Args...)
	cmd.Dir = spec.Dir
	cmd.Env = spec.Env
	if spec.RawArgs {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
		setRawCmdLine(cmd.SysProcAttr, `"`+exe+`" `+strings.Join(spec.Args, " "))
	}
	if err := cmd.Start(); err != nil {
		discard()
		return nil, err
	}
	proc := &ptyProcess{pty: p, cmd: cmd, done: make(chan struct{})}
	proc.lastRead.Store(time.Now().UnixNano())
	go proc.watch()
	return proc, nil
}
