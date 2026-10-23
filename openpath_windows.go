package main

import (
	"fmt"

	"golang.org/x/sys/windows"
)

// openWithDefaultApp opens a document the way Explorer does (ShellExecute
// "open"); no command line is built, so the path cannot inject arguments.
func openWithDefaultApp(path string) error {
	verb, err := windows.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return fmt.Errorf("경로가 올바르지 않습니다: %w", err)
	}
	if err := windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL); err != nil {
		return fmt.Errorf("파일을 열지 못했습니다: %w", err)
	}
	return nil
}
