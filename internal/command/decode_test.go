package command

import "testing"

func TestDecodeKeepsUTF8(t *testing.T) {
	if got := decode([]byte("한글 ok")); got != "한글 ok" {
		t.Fatalf("decode = %q", got)
	}
}

func TestDecodeKeepsCutUTF8(t *testing.T) {
	b := []byte("가나")
	if got := decode(b[:4]); got != string(b[:4]) {
		t.Fatalf("decode = %q", got)
	}
}

func TestDecodeSystemCodePage(t *testing.T) {
	if systemCodePage() != 949 {
		t.Skip("needs a Korean Windows code page")
	}
	// "한글" in CP949, as Windows PowerShell prints it into a pipe.
	if got := decode([]byte{0xc7, 0xd1, 0xb1, 0xdb}); got != "한글" {
		t.Fatalf("decode = %q", got)
	}
}
