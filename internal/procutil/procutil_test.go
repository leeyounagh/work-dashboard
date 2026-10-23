package procutil

import (
	"os/exec"
	"runtime"
	"testing"
)

func TestBackgroundRuns(t *testing.T) {
	name, args := "sh", []string{"-c", "echo ok"}
	if runtime.GOOS == "windows" {
		name, args = "cmd", []string{"/c", "echo ok"}
	}
	out, err := Background(exec.Command(name, args...)).Output()
	if err != nil || len(out) == 0 {
		t.Fatalf("output = %q, %v", out, err)
	}
}
