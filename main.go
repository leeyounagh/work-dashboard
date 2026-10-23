package main

import (
	"context"
	"embed"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/leeyounagh/work-dashboard/internal/bridge"
	"github.com/leeyounagh/work-dashboard/internal/claudeacct"
	"github.com/leeyounagh/work-dashboard/internal/github"
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

func main() {
	dir, err := workspace.DefaultDir()
	if err != nil {
		log.Fatalf("work-dashboard: %v", err)
	}
	runDir := filepath.Join(filepath.Dir(dir), "run")
	if err := cleanRunDir(runDir); err != nil {
		log.Printf("work-dashboard: could not clean %s: %v", runDir, err)
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
		TerminalsLocked: devBuild && os.Getenv("WD_DEV_TERMINALS") != "1",
		Bridge:          br,
		GitHub:          github.GH,
		Claude:          claudeacct.New(claudeacct.Options{}),
		RunDir:          runDir,
	})

	err = wails.Run(&options.App{
		Title:            "work-dashboard",
		Width:            1440,
		Height:           900,
		MinWidth:         960,
		MinHeight:        600,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: windowBackground,
		Windows:          &windows.Options{Theme: windows.Dark},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind:             []any{app},
	})
	if err != nil {
		log.Fatalf("work-dashboard: %v", err)
	}
}
