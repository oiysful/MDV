# 27. PR 자동 리뷰 봇 (claude-code-action)

## 상태
**계획 (2026-10-07).** 착수 전. Ian 수동 작업(secret 등록)이 선행 조건.

## 배경과 결정 경위

- PR이 올라오면 자동으로 리뷰하는 봇을 원한다(Ian).
- 처음 검토한 [tmseidel/ai-git-bot](https://github.com/tmseidel/ai-git-bot)(1.27.0, MIT, Java)은 **기각**:
  상시 서버(Java + Postgres) + 공개 webhook URL(폴링 모드 없음) + 쓰기 PAT를 가진 봇 계정이 필요하고,
  테스트 생성은 `npm test`(MDV에 없음)·Linux 컨테이너(Electron 스위트 불가)라 MDV와 맞지 않는다.
- 대안으로 Anthropic 공식 [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action)
  (v1.0.244, 2026-10-06)을 채택. 서버 없이 PR 이벤트마다 GitHub 러너에서 돌고 끝난다.
- 인증은 **Pro 구독 토큰**(`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`). 공식 `setup.md`에
  "Pro and Max users"로 명시돼 있어 Pro도 정책상 허용. 비용은 0이지만 **사용 한도를 로컬 Claude Code와 공유**한다
  → 트리거를 줄이고 턴 수에 상한을 둔다.

## 착수 전 확인된 제약 (조사 중 발견, 설계에 반영)

### 1. App 토큰 경로는 "기본 브랜치와 동일한 워크플로 파일"을 요구한다
액션의 기본 인증은 OIDC → Claude GitHub App 토큰 교환인데, 서버가 이렇게 거부한다
(`src/github/token.ts`, `test/token.test.ts`):

> Workflow validation failed. The workflow file must exist and have identical content to the version on the
> repository's **default branch**.

MDV의 기본 브랜치는 `main`이고 **`main`은 릴리스 전용**이다(일상 작업·PR 대상은 `develop`). 따라서 App 토큰 경로에서는:
- 워크플로가 `main`에 들어가기 전(= 다음 릴리스 전)까지 **develop 대상 PR 리뷰가 전부 401로 실패**한다.
- 워크플로를 고치는 PR은 자기 자신을 리뷰하지 못하고, 고칠 때마다 main 반영이 필요하다.

→ **`github_token: ${{ secrets.GITHUB_TOKEN }}`을 넘겨 OIDC/App 교환을 건너뛴다.** 이 입력은 보안 문서가
`allowed_non_write_users` 맥락에서 직접 권장하는 형태이고, 토큰은 잡 `permissions:`로 범위가 제한되며 잡 종료 시 만료된다.
대가: 코멘트 작성자가 `claude[bot]`이 아니라 `github-actions[bot]`이 된다. **Claude GitHub App 설치는 불필요해진다.**
(이 입력의 공식 설명은 "custom GitHub app일 때만"이라 적혀 있어, 첫 실행에서 동작을 실측으로 확인해야 한다 — §검증.)

### 2. 코멘트 트리거(`@claude`)는 기본 브랜치의 워크플로만 실행된다
`issue_comment`·`pull_request_review_comment`·`workflow_dispatch`는 GitHub 규칙상 **기본 브랜치(main)의 워크플로 파일**로 돈다.
develop에만 있는 동안에는 `@claude review`가 아무것도 트리거하지 않는다.

→ 수동 재리뷰는 **라벨 트리거**로 한다: `pull_request: types: [labeled]` + 라벨 `claude-review`.
`labeled`는 `pull_request` 이벤트라 PR 쪽 워크플로 파일로 돌고, 붙일 수 있는 사람이 쓰기 권한자로 한정된다.
`@claude` 코멘트 모드는 워크플로가 main에 들어간 뒤(릴리스 이후) 별도로 재검토.

### 3. 구독 토큰 401 미해결 이슈
[#1613](https://github.com/anthropics/claude-code-action/issues/1613)·[#1614](https://github.com/anthropics/claude-code-action/issues/1614)
(2026-09, 열림): `setup-token` 토큰이 로컬에선 되는데 액션에선 `401 OAuth access token is invalid`. 일부는 429가 401로 보이는 경우였고
일부는 진짜 401로 재현됐다. **MDV에서도 재현될 수 있다.** 대비:
- 첫 실행에서 실패하면 `show_full_output: true`로 한 번 돌려 `api_error_status`를 확인(401 vs 429).
- 401이 지속되면 폴백은 **Anthropic API 키**(`ANTHROPIC_API_KEY`, 종량제) — 워크플로 입력 한 줄만 바뀐다. 전환 여부는 Ian 결정.

## 설계

**파일**: `.github/workflows/claude-review.yml` (신규 1개, 앱 코드 변경 없음)

| 항목 | 값 | 이유 |
|---|---|---|
| 이벤트 | `pull_request`: `opened`, `ready_for_review`, `reopened`, `labeled` | `synchronize`(푸시마다) 제외 — 한도 보호 |
| 대상 브랜치 | `develop`, `main` | MDV PR 흐름 그대로 |
| 조건 | Draft 아님; `labeled`면 라벨이 `claude-review`일 때만; 포크 PR 제외(`head.repo.full_name == github.repository`) | 포크엔 secret이 안 가서 어차피 실패 — 명시적으로 skip. 봇 작성 PR(Dependabot·Renovate)은 액션이 기본 거부해 빨간 잡이 되지만, **2026-10-07 확인: `.github/dependabot.yml`·`renovate.json` 없음** → 필터 불필요. 도입 시 `github.actor != 'dependabot[bot]'` 추가 |
| `pull_request_target` | **쓰지 않는다** | 보안 문서가 경고하는 pwn-request 패턴 |
| permissions | `contents: read`, `pull-requests: write`, `issues: write` | `issues: write`는 PR 일반 코멘트용(PR 코멘트 = issue 코멘트 API). 실측 후 불필요하면 제거 |
| 동시성 | **잡 레벨** `concurrency: claude-review-${{ PR 번호 }}`, `cancel-in-progress: true` | 라벨 연타·재오픈 중복 실행 방지. **워크플로 레벨에 두면 안 된다** — 무관한 라벨(`bug` 등)의 `labeled` 실행도 그룹에 들어가 잡 `if`로 skip되기 전에 진행 중인 리뷰를 취소한다. 잡 레벨 그룹은 실제로 도는 잡에만 적용된다 |
| timeout | `timeout-minutes: 15` | 멈춘 잡이 러너·한도를 붙잡지 않게 |
| 모델 | `--model claude-sonnet-5-5` | Pro 한도 대비 비용/품질 |
| 턴 상한 | `--max-turns 25` | 한 건의 소모량 상한 |
| 허용 도구 | `Read`, `Grep`, `Glob`, `Bash(gh pr diff:*)`, `Bash(gh pr view:*)`, `Bash(gh pr comment:*)`, `mcp__github_inline_comment__create_inline_comment` | 읽기 + 코멘트만. `npm`·`node`·앱 실행·`git push`·파일 쓰기 없음 |
| 코멘트 | 프롬프트로 지시: 이전 리뷰 요약이 있으면 `gh pr comment --edit-last`로 갱신 | 커스텀 `prompt` + `track_progress` 없음 = 자동화 모드라 Claude가 `gh pr comment`로 직접 쓴다. `use_sticky_comment`는 액션 자체의 추적 코멘트에만 적용될 수 있어 여기선 무효일 수 있다 — 의존하지 않는다. `--edit-last`는 허용 패턴 `gh pr comment:*` 안 |
| checkout | `actions/checkout` 기본(`pull_request`의 merge ref), `fetch-depth: 1` | PR head를 따로 체크아웃하지 않음 |
| 문서 전용 PR | **필터 없음**(리뷰함) | 영어/`.ko.md` 짝 동기화 확인이 문서 PR에서 가장 유용 |

라벨 재리뷰 후에는 다음 재리뷰를 위해 라벨을 떼야 한다(같은 라벨 재부착 = 새 `labeled` 이벤트). 자동 제거는 쓰기 도구가 늘어나므로 하지 않는다.

**신뢰 경계**: 액션이 `.claude/`·`CLAUDE.md`를 **base 브랜치에서 복원**하므로 PR이 리뷰어 지침을 바꿔치기할 수 없다. 나머지 파일은 PR head 그대로지만
허용 도구가 읽기뿐이라 PR이 심은 스크립트가 실행될 경로가 없다. 액션은 쓰기 권한자가 일으킨 이벤트만 처리한다(기본값; `allowed_bots`·`allowed_non_write_users`는 설정하지 않는다).

### 리뷰 프롬프트 (MDV 전용)

일반 체크리스트가 아니라 이 저장소에서 실제로 사고가 났던 축만:
1. **Electron 보안**: `contextIsolation`/`sandbox`/`nodeIntegration`, preload 노출 API, IPC 핸들러의 입력 검증·경로 탈출.
2. **렌더러 XSS**: DOMPurify 경유 여부, `innerHTML`, data-* 속성의 원문 저장(base64 규칙 — AGENTS.md).
3. **이중 언어 문서**: `README`/`CONTRIBUTING`/`RELEASING` 중 한쪽만 바뀌었으면 `.ko.md` 짝 누락 지적.
4. **테스트**: 동작 변경에 테스트가 따라왔는지, 고정 지연·만료되는 관측 창 같은 플레이크 패턴(AGENTS.md NOTES).
5. **성능**: 마크다운 파이프라인의 O(n²) 패턴(인라인 확장 `start()` 등 — 계획 23·24).
- 출력: 확실한 결함만 인라인으로, 요약은 PR 코멘트 하나(이전 요약이 있으면 `--edit-last`로 갱신). 스타일 지적·칭찬 금지. 한국어로 작성.
- **금지**: 코드 수정 제안을 커밋하지 말 것, 테스트·앱 실행 시도 금지.

## 구현 단계

1. (Ian) `claude setup-token` → `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R oiysful/MDV` — 별도 터미널에서.
2. (Claude) develop에서 `ci/claude-review` 브랜치 → 워크플로 작성 → PR(develop 대상).
   - `github_token` 경로라 이 PR 자신이 첫 리뷰 대상이 된다(App 경로였다면 불가능 — 제약 1).
3. 첫 실행 확인(§검증) → 통과 시 Ian 승인 후 머지.
4. AGENTS.md에 "PR 자동 리뷰" 한 단락(트리거·라벨 재리뷰·토큰 만료 시 증상) + `CONTRIBUTING.md`/`.ko.md`에 라벨 사용법 한 줄.

## 검증

| 확인 | 방법 | 통과 기준 |
|---|---|---|
| 인증 | 단계 2 PR의 첫 실행 로그 | 401/429 없음. 실패 시 제약 3의 절차 |
| `github_token` 경로 동작 | 같은 실행 | OIDC 교환 시도 없이 진행, 코멘트 작성자 `github-actions[bot]` |
| 리뷰 품질 | 결함을 일부러 심은 테스트 커밋 1개(예: preload에서 `ipcRenderer` 통째 노출, README만 수정) | 두 건 모두 지적. 확인 후 커밋 되돌림 |
| 도구 제한 | 실행 로그의 도구 호출 목록 | 허용 목록 밖 호출 0, 저장소 쓰기 0 |
| 라벨 재리뷰 | `claude-review` 라벨 부착 | 새 실행 1회(필수). 요약 코멘트가 갱신되면 좋고, 새로 하나 달려도 허용(재리뷰는 수동이라 실행당 1개) |
| 무관한 라벨 | 리뷰 진행 중에 `bug` 같은 다른 라벨 부착 | 진행 중 리뷰가 취소되지 않음 |
| Draft skip | Draft로 연 PR | 잡 skipped |
| 한도 영향 | 1~2주 운용 후 Ian 체감 | 로컬 작업이 한도에 걸리는 일이 늘면 API 키 전환 검토 |

## 운영 메모

- 토큰 만료 시 증상: 리뷰 잡이 인증 오류로 빨간색. ci.yml/ci-electron.yml과 무관하며 **필수 체크가 아니다**(main ruleset에 required checks 없음 — 2026-09-18).
- 리뷰 봇은 사람 승인·codex 교차 리뷰를 대체하지 않는다. 머지 규칙(PR 생성 자율, 머지는 Ian 승인)은 그대로.
- 액션은 `@v1` 부동 태그. 공급망 위험을 줄이려면 커밋 SHA 고정을 검토(업데이트 빈도가 하루 1회 수준이라 수동 갱신 부담과 거래).

## 보류·후속

- `@claude` 코멘트 대화 모드: 워크플로가 main에 반영된 뒤(다음 릴리스) 재검토.
- `synchronize` 자동 재리뷰: 한도 여유가 확인되면.
- Claude GitHub App 경로(`claude[bot]` 명의): 워크플로가 main과 동일하게 유지되는 운용이 가능해지면.
