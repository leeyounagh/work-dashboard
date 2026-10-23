package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"github.com/leeyounagh/work-dashboard/internal/workspace"
)

//go:embed all:frontend/dist
var assets embed.FS

// windowBackground matches --bg in frontend/src/styles/tokens.css so the
// window does not flash a different colour before the page paints.
var windowBackground = &options.RGBA{R: 0x1e, G: 0x1f, B: 0x22, A: 0xff}

func main() {
	dir, err := workspace.DefaultDir()
	if err != nil {
		log.Fatalf("work-dashboard: %v", err)
	}
	app := NewApp(workspace.NewStore(dir))

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
		Bind:             []any{app},
	})
	if err != nil {
		log.Fatalf("work-dashboard: %v", err)
	}
}
