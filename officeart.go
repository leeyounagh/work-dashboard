package main

import (
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// Office pets and cut-out standees: the user's own art, kept on this computer
// only (fan art they may not redistribute), like the character sheets.
//
// A pet is a Petdex-style sheet (8 columns × 9 rows of equal frames: idle,
// run right, run left, wave, jump, sad, wait, run, review) in
// ~/.work-dashboard/pets/<name>.png, with optional lines it says when
// clicked in <name>.txt, one per line, and an optional name shown under it
// in <name>.name (the first line). A standee is any picture in
// ~/.work-dashboard/decor/*.png.
const (
	maxPetBytes   = 1 << 20
	maxPets       = 4
	maxDecorBytes = 512 << 10
	maxDecor      = 8 // MAX_DECOR in frontend/src/office/room.ts
	maxLinesBytes = 4 << 10
	maxPetLines   = 30
	maxLineRunes  = 40
	// maxPetNameRunes keeps a pet's name tag about as wide as the pet.
	maxPetNameRunes = 12
)

// PetSprite is one pet's sheet (a data URL), what it may say and its name ("" for none).
type PetSprite struct {
	Sheet string   `json:"sheet"`
	Lines []string `json:"lines"`
	Name  string   `json:"name"`
}

// readPetName is the first line of a pet's .name file, cut to maxPetNameRunes.
func readPetName(path string) string {
	lines := readLines(path)
	if len(lines) == 0 {
		return ""
	}
	name := []rune(lines[0])
	if len(name) > maxPetNameRunes {
		name = name[:maxPetNameRunes]
	}
	return string(name)
}

func loadPets(dir string) []PetSprite {
	pets := []PetSprite{}
	for _, name := range pngNames(dir) {
		if len(pets) == maxPets {
			break
		}
		url, ok := readPNG(filepath.Join(dir, name), maxPetBytes)
		if !ok {
			continue
		}
		base := filepath.Join(dir, strings.TrimSuffix(name, filepath.Ext(name)))
		pets = append(pets, PetSprite{Sheet: url, Lines: readLines(base + ".txt"), Name: readPetName(base + ".name")})
	}
	return pets
}

func loadDecor(dir string) []string {
	decor := []string{}
	for _, name := range pngNames(dir) {
		if len(decor) == maxDecor {
			break
		}
		if url, ok := readPNG(filepath.Join(dir, name), maxDecorBytes); ok {
			decor = append(decor, url)
		}
	}
	return decor
}

// readLines reads a pet's lines: short plain text, blank lines dropped; none if missing or too big.
func readLines(path string) []string {
	lines := []string{}
	if info, err := os.Lstat(path); err != nil || !info.Mode().IsRegular() || info.Size() > maxLinesBytes {
		return lines
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return lines
	}
	text := strings.TrimPrefix(strings.ToValidUTF8(string(data), ""), "\xef\xbb\xbf") // a BOM
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.Map(func(r rune) rune {
			switch {
			case r == '	':
				return ' '
			case unicode.IsControl(r), unicode.Is(unicode.Cf, r): // control and invisible format characters
				return -1
			}
			return r
		}, raw))
		if line == "" {
			continue
		}
		if r := []rune(line); len(r) > maxLineRunes {
			line = string(r[:maxLineRunes])
		}
		lines = append(lines, line)
		if len(lines) == maxPetLines {
			break
		}
	}
	return lines
}
