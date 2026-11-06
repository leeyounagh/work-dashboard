package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// pngOf is the start of a PNG declaring a w × h image: enough for the checks here.
func pngOf(w, h uint32) []byte {
	data := append([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR"), make([]byte, 8+16)...)
	binary.BigEndian.PutUint32(data[16:20], w)
	binary.BigEndian.PutUint32(data[20:24], h)
	return data
}

var testPNG = pngOf(16, 16)

func writeFiles(t *testing.T, dir string, files map[string][]byte) {
	t.Helper()
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCustomSpritesPetsAndDecor(t *testing.T) {
	h := newHarness(t)
	pets, decor := t.TempDir(), t.TempDir()
	h.app.deps.PetsDir = pets
	h.app.deps.DecorDir = decor
	long := strings.Repeat("가", maxLineRunes+5)
	writeFiles(t, pets, map[string][]byte{
		"gintoki.png": testPNG,
		"gintoki.txt": []byte("\xef\xbb\xbf당분이 부족해…\r\n\n  월요일은 점프  \nbell\a\there\u200bx\n" + long + "\n"),
		"quiet.png":   testPNG,
		"fake.png":    []byte("not a png"),
		"huge.png":    append(append([]byte{}, testPNG...), make([]byte, maxPetBytes)...),
	})
	writeFiles(t, decor, map[string][]byte{
		"standee.png": testPNG,
		"note.txt":    testPNG,
		"huge.png":    append(append([]byte{}, testPNG...), make([]byte, maxDecorBytes)...),
	})

	got := h.app.CustomSprites()
	if len(got.Pets) != 2 || !strings.HasPrefix(got.Pets[0].Sheet, "data:image/png;base64,") {
		t.Fatalf("pets = %+v", got.Pets)
	}
	want := []string{"당분이 부족해…", "월요일은 점프", "bell herex", strings.Repeat("가", maxLineRunes)}
	if fmt.Sprint(got.Pets[0].Lines) != fmt.Sprint(want) {
		t.Fatalf("lines = %q, want %q", got.Pets[0].Lines, want)
	}
	// No .txt: no lines, but still a pet.
	if got.Pets[1].Lines == nil || len(got.Pets[1].Lines) != 0 {
		t.Fatalf("quiet pet lines = %#v", got.Pets[1].Lines)
	}
	if len(got.Decor) != 1 || !strings.HasPrefix(got.Decor[0], "data:image/png;base64,") {
		t.Fatalf("decor = %d", len(got.Decor))
	}
}

func TestCustomSpritesPetAndDecorCaps(t *testing.T) {
	h := newHarness(t)
	pets, decor := t.TempDir(), t.TempDir()
	h.app.deps.PetsDir = pets
	h.app.deps.DecorDir = decor
	for i := 0; i < maxPets+2; i++ {
		writeFiles(t, pets, map[string][]byte{fmt.Sprintf("p%02d.png", i): testPNG})
	}
	for i := 0; i < maxDecor+2; i++ {
		writeFiles(t, decor, map[string][]byte{fmt.Sprintf("d%02d.png", i): testPNG})
	}
	many := strings.Repeat("line\n", maxPetLines+5)
	writeFiles(t, pets, map[string][]byte{"p00.txt": []byte(many)})
	got := h.app.CustomSprites()
	if len(got.Pets) != maxPets || len(got.Decor) != maxDecor {
		t.Fatalf("pets = %d, decor = %d", len(got.Pets), len(got.Decor))
	}
	if len(got.Pets[0].Lines) != maxPetLines {
		t.Fatalf("lines = %d, want %d", len(got.Pets[0].Lines), maxPetLines)
	}
	// A lines file over the size limit is ignored.
	writeFiles(t, pets, map[string][]byte{"p00.txt": []byte(strings.Repeat("x", maxLinesBytes+1))})
	if got := h.app.CustomSprites(); len(got.Pets[0].Lines) != 0 {
		t.Fatalf("oversized lines = %d", len(got.Pets[0].Lines))
	}
}

func TestCustomSpritesWithoutPetOrDecorFolders(t *testing.T) {
	h := newHarness(t)
	h.app.deps.PetsDir = filepath.Join(t.TempDir(), "missing")
	h.app.deps.DecorDir = ""
	got := h.app.CustomSprites()
	if got.Pets == nil || got.Decor == nil || len(got.Pets)+len(got.Decor) != 0 {
		t.Fatalf("got %#v / %#v, want empty lists", got.Pets, got.Decor)
	}
}

func TestPNGSizeOK(t *testing.T) {
	for _, c := range []struct {
		name string
		data []byte
		want bool
	}{
		{"small", pngOf(50, 115), true},
		{"largest side", pngOf(maxPNGSide, 1), true},
		{"too wide", pngOf(maxPNGSide+1, 10), false},
		{"too tall", pngOf(10, 16000), false},
		{"zero", pngOf(0, 10), false},
		{"no header", append(pngOf(16, 16)[:8:8], make([]byte, 32)...), false},
		{"short", pngOf(16, 16)[:8], false},
		{"not png", []byte("GIF89a and then some more bytes here"), false},
	} {
		if got := pngSizeOK(c.data); got != c.want {
			t.Errorf("%s: pngSizeOK = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestCustomSpritesSkipsHugeImages(t *testing.T) {
	h := newHarness(t)
	dir := t.TempDir()
	h.app.deps.DecorDir = dir
	writeFiles(t, dir, map[string][]byte{"a.png": pngOf(16000, 16000), "b.png": testPNG})
	if got := h.app.CustomSprites(); len(got.Decor) != 1 {
		t.Fatalf("decor = %d, want only the small one", len(got.Decor))
	}
}
