// Package widget defines the catalog of dashboard widgets and validates
// per-workspace widget instances against it.
package widget

import "slices"

// Source is where a widget gets its data from.
type Source string

const (
	SourceGitHub Source = "github" // gh CLI
	SourceClaude Source = "claude" // Claude Code (credentials, headless calls, MCP connectors)
	SourceLocal  Source = "local"  // files and processes on this machine
)

// Widget type IDs.
const (
	PRReviews      = "pr-reviews"
	CIFailures     = "ci-failures"
	ReviewQueue    = "review-queue"
	LinearIssues   = "linear-issues"
	NotionSpecs    = "notion-specs"
	DeploySwap     = "deploy-swap"
	Worktrees      = "worktrees"
	QA2Pass        = "qa-2pass"
	ClaudeUsage    = "claude-usage"
	SessionRestore = "session-restore"
)

// Definition describes a widget type the dashboard can render.
type Definition struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Source      Source        `json:"source"`
	Settings    []SettingSpec `json:"settings"`
}

var prScope = []string{"mine", "review-requested", "both"}

var catalog = []Definition{
	{
		ID:          PRReviews,
		Name:        "PR 리뷰 현황",
		Description: "PR별 리뷰어 상태(승인·변경 요청·미리뷰)와 강조 조건",
		Source:      SourceGitHub,
		Settings: []SettingSpec{
			{Key: "scope", Label: "대상 PR", Kind: KindEnum, Default: "mine", Options: prScope},
			{Key: "reviewers", Label: "리뷰어 (비우면 전체)", Kind: KindStringList, Default: []string{}},
			{Key: "highlightNoReview", Label: "리뷰 0회 강조", Kind: KindBool, Default: true},
			{Key: "highlightChangesRequested", Label: "변경 요청 강조", Kind: KindBool, Default: true},
			{Key: "minApprovals", Label: "필요 승인 수", Kind: KindInt, Default: 1, Min: 0, Max: 10},
			{Key: "repos", Label: "레포 (비우면 전체)", Kind: KindStringList, Default: []string{}},
		},
	},
	{
		ID:          CIFailures,
		Name:        "CI 실패 PR",
		Description: "체크가 실패한 PR과 실패한 잡",
		Source:      SourceGitHub,
		Settings: []SettingSpec{
			{Key: "scope", Label: "대상 PR", Kind: KindEnum, Default: "mine", Options: prScope},
			{Key: "repos", Label: "레포 (비우면 전체)", Kind: KindStringList, Default: []string{}},
		},
	},
	{
		ID:          ReviewQueue,
		Name:        "리뷰 요청 큐",
		Description: "나에게 온 리뷰 요청과 대기 시간",
		Source:      SourceGitHub,
		Settings: []SettingSpec{
			{Key: "repos", Label: "레포 (비우면 전체)", Kind: KindStringList, Default: []string{}},
			{Key: "staleHours", Label: "오래 기다림 기준(시간)", Kind: KindInt, Default: 24, Min: 1, Max: 720},
		},
	},
	{
		ID:          LinearIssues,
		Name:        "Linear 내 이슈",
		Description: "Claude에 연결된 Linear 커넥터로 가져온 내 이슈",
		Source:      SourceClaude,
		Settings: []SettingSpec{
			{Key: "teams", Label: "팀 키 (비우면 전체)", Kind: KindStringList, Default: []string{}},
			{Key: "states", Label: "상태 (비우면 전체)", Kind: KindStringList, Default: []string{}},
		},
	},
	{
		ID:          NotionSpecs,
		Name:        "Notion 명세",
		Description: "Claude에 연결된 Notion 커넥터로 가져온 명세 문서의 버전과 수정일",
		Source:      SourceClaude,
		Settings: []SettingSpec{
			{Key: "pages", Label: "페이지 ID", Kind: KindStringList, Default: []string{}},
		},
	},
	{
		ID:          DeploySwap,
		Name:        "배포·스왑 대기",
		Description: "머지됐지만 운영에 반영(스왑)되지 않은 배포",
		Source:      SourceLocal,
		Settings: []SettingSpec{
			{Key: "command", Label: "상태 조회 명령", Kind: KindString, Default: ""},
			{Key: "staleDays", Label: "경고 기준(일)", Kind: KindInt, Default: 1, Min: 0, Max: 60},
		},
	},
	{
		ID:          Worktrees,
		Name:        "워크트리 상태",
		Description: "워크스페이스 폴더의 git worktree별 기준 브랜치 대비 ahead/behind",
		Source:      SourceLocal,
		Settings: []SettingSpec{
			{Key: "baseRef", Label: "기준 브랜치", Kind: KindString, Default: "origin/main"},
			{Key: "staleBehind", Label: "낡음 기준(behind 커밋 수)", Kind: KindInt, Default: 100, Min: 1, Max: 10000},
		},
	},
	{
		ID:          QA2Pass,
		Name:        "QA (qa-2pass)",
		Description: "qa-2pass 도메인·기능별 실행 버튼과 결과 이력",
		Source:      SourceClaude,
		Settings: []SettingSpec{
			{Key: "domain", Label: "도메인", Kind: KindString, Default: ""},
			{Key: "features", Label: "기능", Kind: KindStringList, Default: []string{}},
		},
	},
	{
		ID:          ClaudeUsage,
		Name:        "Claude 한도·로그인",
		Description: "5시간·7일 사용률, 리셋 시각, 로그인 계정",
		Source:      SourceClaude,
		Settings: []SettingSpec{
			{Key: "alertPercent", Label: "알림 기준(%)", Kind: KindInt, Default: 90, Min: 50, Max: 100},
		},
	},
	{
		ID:          SessionRestore,
		Name:        "세션 복원",
		Description: "앱을 다시 켤 때 터미널 탭과 Claude 대화를 복원",
		Source:      SourceLocal,
		Settings: []SettingSpec{
			{Key: "resumeClaude", Label: "claude --resume 으로 이어가기", Kind: KindBool, Default: true},
		},
	},
}

func cloneDefinition(def Definition) Definition {
	settings := make([]SettingSpec, len(def.Settings))
	for i, s := range def.Settings {
		settings[i] = cloneSpec(s)
	}
	def.Settings = settings
	return def
}

// Catalog returns a deep copy of every widget definition.
func Catalog() []Definition {
	out := make([]Definition, len(catalog))
	for i, def := range catalog {
		out[i] = cloneDefinition(def)
	}
	return out
}

// Lookup returns a deep copy of the definition for a widget type ID.
func Lookup(id string) (Definition, bool) {
	def, ok := find(id)
	if !ok {
		return Definition{}, false
	}
	return cloneDefinition(def), true
}

// find returns the shared definition; callers must not modify it.
func find(id string) (Definition, bool) {
	idx := slices.IndexFunc(catalog, func(d Definition) bool { return d.ID == id })
	if idx < 0 {
		return Definition{}, false
	}
	return catalog[idx], true
}
