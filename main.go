package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/leeyounagh/work-dashboard/internal/bridge"
	"github.com/leeyounagh/work-dashboard/internal/claudeacct"
	"github.com/leeyounagh/work-dashboard/internal/claudeask"
	"github.com/leeyounagh/work-dashboard/internal/github"
	"github.com/leeyounagh/work-dashboard/internal/launch"
	"github.com/leeyounagh/work-dashboard/internal/sessions"
	"github.com/leeyounagh/work-dashboard/internal/term"
	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

//go:embed all:frontend/dist
var assets embed.FS

// windowBackground matches --bg in frontend/src/styles/tokens.css so the
// window does not flash a different colour before the page paints.
var windowBackground = &options.RGBA{R: 0x1e, G: 0x1f, B: 0x22, A: 0xff}

// preferredShell returns PowerShell 7 when installed, else Windows PowerShell.
func preferredShell() string {
	if _, err := exec.LookPath("pwsh"); err == nil {
		return "pwsh"
	}
	return "powershell.exe"
}

// askClaude runs headless claude (resolved on each call, so installing Claude
// Code while the app runs works).
func askClaude(ctx context.Context, dir string, args ...string) ([]byte, error) {
	exe, err := exec.LookPath("claude")
	if err != nil {
		return nil, fmt.Errorf("claude 를 찾지 못했습니다: %w", err)
	}
	exe = launch.ResolveExecutable(exe)
	// A .cmd we cannot resolve would put arguments through cmd.exe parsing.
	if ext := strings.ToLower(filepath.Ext(exe)); ext == ".cmd" || ext == ".bat" {
		return nil, fmt.Errorf("claude 실행 파일(%s)을 직접 찾지 못했습니다", exe)
	}
	return claudeask.Claude(exe)(ctx, dir, args...)
}

func instanceID() string {
	if devBuild {
		return "work-dashboard-dev.leeyounagh.github.io"
	}
	return "work-dashboard.leeyounagh.github.io"
}

func main() {
	dir, err := workspace.DefaultDir()
	if err != nil {
		log.Fatalf("work-dashboard: %v", err)
	}
	runDir := filepath.Join(filepath.Dir(dir), "run")
	if err := cleanRunDir(runDir); err != nil {
		log.Printf("work-dashboard: could not clean %s: %v", runDir, err)
	}

	sessionStore := sessions.NewStore(filepath.Join(filepath.Dir(dir), "sessions.json"))
	restorable, err := sessionStore.TakeOpenAtExit()
	if err != nil {
		log.Printf("work-dashboard: session history unavailable: %v", err)
	}

	var app *App
	// The bridge must exist before the app so sessions can be configured with
	// its URL; its handlers reach the app once it is created below.
	br, err := bridge.Start(bridge.Handlers{
		OnHook:      func(key string, ev bridge.HookEvent) { app.onHook(key, ev) },
		OnOpenFiles: func(key string, paths []string) ([]string, error) { return app.onOpenFiles(key, paths) },
	})
	if err != nil {
		log.Fatalf("work-dashboard: %v", err)
	}
	defer br.Close()

	app = NewApp(Deps{
		Workspaces:   workspace.NewStore(dir),
		Start:        term.StartPTY,
		Emit:         func(ctx context.Context, name string, data any) { runtime.EventsEmit(ctx, name, data) },
		FindClaude:   func() (string, error) { return exec.LookPath("claude") },
		Shell:        preferredShell(),
		NotesDir:     filepath.Join(filepath.Dir(dir), "notes"),
		NewSessionID: func() string { return uuid.NewString() },
		PickFolder: func(ctx context.Context) (string, error) {
			return runtime.OpenDirectoryDialog(ctx, runtime.OpenDialogOptions{Title: "워크스페이스에 추가할 폴더"})
		},
		DevLocked:     devBuild && os.Getenv("WD_DEV_UNLOCK") != "1",
		Bridge:        br,
		GitHub:        github.GH,
		Ask:           askClaude,
		Sessions:      sessionStore,
		Restorable:    restorable,
		CharactersDir: filepath.Join(filepath.Dir(dir), "characters"),
		TodosDir:      filepath.Join(filepath.Dir(dir), "todos"),
		Claude:        claudeacct.New(claudeacct.Options{}),
		RunDir:        runDir,
		OpenPath:      openWithDefaultApp,
	})

	err = wails.Run(&options.App{
		Title:            "work-dashboard",
		Width:            1440,
		Height:           900,
		MinWidth:         960,
		MinHeight:        600,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: windowBackground,
		// WebView2's zoom stays off: Wails disables its keys anyway, and the UI
		// zooms itself (Ctrl + / Ctrl - / Ctrl 0, frontend/src/layout/zoom.ts).
		Windows:    &windows.Options{Theme: windows.Dark, IsZoomControlEnabled: false, ZoomFactor: 1.0},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		SingleInstanceLock: &options.SingleInstanceLock{
			// Dev builds use their own id so `wails dev` never blocks the installed app.
			UniqueId: instanceID(),
		},
		Bind: []any{app},
	})
	if err != nil {
		log.Fatalf("work-dashboard: %v", err)
	}
}
