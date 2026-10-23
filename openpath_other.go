//go:build !windows

package main

import "errors"

func openWithDefaultApp(string) error {
	return errors.New("이 운영체제에서는 파일 열기를 지원하지 않습니다")
}
