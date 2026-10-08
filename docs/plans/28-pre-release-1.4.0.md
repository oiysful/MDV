# 28. v1.4.0 릴리스 전 정리 — Electron 44 CI 멈춤 실험부터 릴리스 당일까지

## 상태
**진행 중.** 순서는 Ian 승인(2026-10-08): 1 → 2 → 3 → 4 → 5 → 6.

**1단계 결과 (2026-10-08) — H1 지지, CI에 `--disable-gpu` 채택.** Draft PR #38, 실행 37730245504, 두 번(attempt 1·2), 변형을 시간상 섞음.

| 변형 | attempt 1 멈춘 잡 | attempt 2 | 합계 | 멈춤 수 |
|---|---|---|---|---|
| baseline | 3/8 | 5/8 | **8/16** | 12 |
| `--disable-gpu`(16잡 모두 `[mdv-gpu-status]` `gpu_compositing: disabled_software` → 전부 유효) | 0/8 | 0/8 | **0/16** | 0 |

attempt 1만으론 3 vs 0이라 미리 정한 규칙대로 "보류 → 8+8 한 번 더"였고, 합산(규칙을 16회로 비례: baseline ≥8, disable-gpu ≤2)에서 지지.
같은 PR의 일반 `CI (Electron)` 1회(baseline, 멈춤 1)는 사후 표본이라 판정에 넣지 않았다. 주장의 범위는 위에 적은 대로 "하드웨어 가속 렌더링 경로".
부수 관찰: disable-gpu 잡은 2~3분, baseline은 4~7분. **2단계 관련: #61은 32잡 중 3잡(baseline 1, disable-gpu 2)에서 실패했고 셋 다 그 잡에 멈춤이 없었다 → "멈춤 여파" 가설 기각, 자체 결함.**

## 배경

v1.3.0(2026-09-17) 이후 develop에 PR #8~#37이 쌓였다 — 기능 4(인용문 Enter, 60em 폭, Gitea식 프론트매터, 인쇄 세로표),
버그 5(볼륨 소실 크래시, 테마 먹통, 단어 내부 물결, mermaid 6px 스크롤, 대화상자 시작 폴더), 보안 1(프론트매터 렌더 예산),
Electron 42 → 44(최소 macOS 13). 버전은 **v1.4.0**(마이너).

릴리스를 막거나 흐리게 하는 것은 셋이다: develop CI의 audit 빨간불(쿨다운 대기), Electron 44 CI 전용 멈춤(열림),
그리고 2026-10-07에 처음 나온 목차 테스트 실패(#61).

## 1. Electron 44 CI 멈춤 — 측정으로 원인 후보를 가른다

### 지금까지의 실측
- 10-02 머지 이후 `ci-electron.yml` 9회 중 3회 실패(10-07만 보면 7회 중 3회). 10-02 PR #31 당시 13회 중 4회.
- 증상이 매번 같다: 테스트 하나가 **~51초(±0.7)** 멈췄다가 스스로 풀린다. 진단 줄은 `rafTicksIn500ms: "no answer within 2000ms"`,
  Tab/GPU CPU 0 — 렌더러가 바쁜 게 아니라 **프레임이 멈춤**. 멈춘 테스트가 15초 대기 안에 있으면 실패, 아니면 51초 걸리고 통과
  (10-07 07:06 실행의 Cmd+B 테스트: 51.4초, ok).
- 멈추는 테스트는 매번 다르다(분할 경계 드래그 ×2, 폴링 감시 #41, Cmd+B, 10-02의 툴팁·클릭·앵커 스크롤).
- 로컬에선 한 번도 재현되지 않음. 동시 실행 2·4 모두에서 발생(동시성 기각, 10-02). Electron 42에선 ~30회 중 0회.
- Electron 44.5.0~44.7.0 릴리스 노트에 GPU·프레임 멈춤 수정 없음(44.7.0의 ANGLE/Chromium 백포트는 미지수).

### 사전 확인: 러너 전체가 아니라 앱 하나가 멈춘다 (기존 로그, 2026-10-08)
CI는 파일 2개를 동시에 돌리므로(`MDV_ELECTRON_CONCURRENCY=2`) 멈춤 동안 다른 파일의 테스트가 늘 함께 돈다. 러너 전체(WindowServer·가상
디스플레이)가 얼었다면 그 테스트도 51초 이상 걸려야 한다. 실패 3회 중 2회는 40초 넘은 테스트가 멈춘 하나뿐, 나머지 1회는 다른 파일에서
51.39초·51.09초 두 건(별개 멈춤 두 번으로 보임). → **멈춤은 앱 인스턴스 단위**이고, 앱별 플래그 실험이 의미 있다.
주의: `node --test`는 동시 실행 파일의 TAP 출력을 파일 순서대로 모아 내보내므로 `ok` 줄의 타임스탬프로 "멈춤 중 다른 테스트가 끝났는지"를
볼 수는 없다 — 그래서 시각이 아니라 소요 시간으로 판정했다.

### 가설과 반증 가능한 실험
**H1(유력, 메모리 `mdv-electron44-ci-stall`): 러너의 가상 GPU에서 GPU 프로세스가 멈춘다.** 맞다면 GPU를 끄면 멈춤이 사라져야 하고,
틀렸다면 그대로 나와야 한다.

**구현(실험 브랜치 `ci/e44-stall-experiment`, 머지하지 않음)**
- `tests/electron/helpers/launch.js`: `args: ['.']` → `args: [...extraArgs, '.']`, `extraArgs`는 `MDV_ELECTRON_EXTRA_ARGS`(공백 구분)에서.
  앱 코드(`src/`)는 건드리지 않는다.
- 임시 워크플로 `.github/workflows/e44-stall-experiment.yml`(`pull_request`): `ci-electron.yml`의 `test-electron` 잡을 복제하고
  `strategy.matrix`, `fail-fast: false`. `disable-gpu`만 `MDV_ELECTRON_EXTRA_ARGS=--disable-gpu`.
  동시 실행·러너·타임아웃은 `ci-electron.yml`과 동일하게 둔다(변수는 GPU 하나만).
  - **두 변형을 시간상 섞는다.** GitHub는 matrix 첫 키를 바깥 루프로 잡을 만들고 macOS 동시 실행은 ~5개라, `variant`가 먼저면 baseline 8개가
    먼저 다 돌고 disable-gpu가 나중 시간대에 돈다. 멈춤은 시간대에 몰린 전력이 있다(10-02: 실패 전부 10:24~12:51 KST, 이후 재실행 5연속 초록).
    → `include:`로 `baseline-1, disable-gpu-1, baseline-2, …` 순서를 명시. 첫 실행 UI에서 잡 생성 순서를 확인.
- 테스트 단계는 `npm run test:electron 2>&1 | tee electron.log`(+ `set -o pipefail`로 종료 코드 보존). 다음 단계 **`if: always()`**로
  `electron.log`에서 `duration_ms > 40000`인 테스트 수를 세어 `$GITHUB_STEP_SUMMARY`에 출력 — **실패 여부가 아니라 멈춤 횟수가 지표**다
  (멈춘 뒤 통과한 테스트도 잡아야 하고, 멈춤이 15초 대기에 걸려 테스트 단계가 실패한 잡이야말로 세야 하므로).
- **러너에서 플래그가 먹었는지 잡마다 기록**: `MDV_ELECTRON_EXTRA_ARGS`가 설정된 잡은 `launch.js`가 첫 실행에서
  `app.getGPUFeatureStatus()`를 한 줄 로그(`[mdv-gpu-status]`). disable-gpu 잡에 `disabled_*`가 안 보이면 그 잡은 **무효로 제외**
  ("효과 없음"으로 세지 않는다).
- PR은 **Draft로 연다** — `opened`가 리뷰 봇을 깨워 닫을 PR에 Pro 한도를 쓰지 않게(Draft는 봇이 skip). Draft여도 `ci-electron.yml`은 돌므로
  baseline 표본이 하나 더 생긴다.

**사전 확인(실험 전에, 로컬)**: `--disable-gpu`가 Playwright 실행 인자로 실제 먹는지 —
`electronApp.evaluate(({ app }) => app.getGPUFeatureStatus())`에서 `gpu_compositing`/`webgl` 등이 `disabled_*`로 바뀌는지 확인.
안 바뀌면 인자 위치·방식을 고친 뒤 진행(먹지 않는 플래그로 16잡을 돌리면 "효과 없음"이라는 거짓 결론이 나온다).
`disable-gpu` 변형에서 로컬 스위트 113건이 통과하는지도 확인(소프트웨어 렌더링이 다른 테스트를 깨면 그것도 결과다).

**판정 기준(실험 전에 고정)**
"멈춘 잡" = 40초 넘은 테스트가 1건 이상인 잡(유효 잡만, 각 변형 8회 기준).

| 결과 | 판정 |
|---|---|
| baseline ≥4, disable-gpu ≤1 | H1 지지(뚜렷한 감소) → 채택 |
| 두 변형이 비슷(차이 ≤1) | H1 기각 → 다음 후보 |
| 그 사이(예: 5 vs 2) | 결론 보류 — 같은 설계로 8+8 한 번 더, 합산해서 위 기준 재적용 |
| baseline ≤1 | 실험 무효(기준 재현 실패) — 결론 내지 않고 시간대를 바꿔 재실행 |

baseline 실패율 ~40%를 가정하면 disable-gpu가 우연히 8회 연속 0회일 확률은 0.6⁸ ≈ 1.7%.

**주장의 범위**: macOS에서 `--disable-gpu`여도 소프트웨어 합성을 위한 GPU/viz 프로세스는 남는다(진단 줄에 이미 `GPU` 프로세스가 찍힌다).
그래서 효과가 없다는 결과는 "**하드웨어 가속 경로**는 원인이 아니다"까지만 말하고, "GPU 프로세스 멈춤" 전체를 기각하지 않는다.
효과가 있다는 결과도 "하드웨어 가속 경로에서 멈춘다"까지다.

**채택 시**: `MDV_ELECTRON_EXTRA_ARGS` 경로를 develop에 정식 PR로 넣고 `ci-electron.yml`에서만 `--disable-gpu`를 켠다.
배포 앱은 바뀌지 않는다. AGENTS.md·RELEASING.md의 멈춤 항목을 "CI 전용 우회 + 원인(가상 GPU)"로 갱신하고, 로컬은 GPU 그대로라는 점을 명시.
**기각 시** 다음 후보를 같은 틀로: (a) Electron 44.7.0(쿨다운 10-15 04:26 KST 이후 — 4단계와 합침), (b) 러너 이미지 고정(`macos-14`/`macos-15`),
(c) 끝까지 안 되면 Ian과 Electron 43(EOL 2027-01-05) 회귀 논의.

**비용**: 공개 저장소라 러너 비용 0. 16잡 × ~5분, macOS 동시 실행 상한 때문에 실측 25~40분.

## 2. 목차 테스트 #61 — 새 실패, 회귀로 다룬다

`links-and-toc.test.js:407` "source-mode TOC rebuild keeps the active entry without waiting for a scroll event",
2026-10-07 08:02 develop 실행(37591124229)에서 1.55초 만에 `AssertionError`: 기대 `#toc-rebuild-doc`, 실제 `#section-6`.
`scrollTop = 0`에서 resize로 `rebuildSourceModeToc()`를 돌렸는데 활성 항목이 문서 중간으로 잡혔다.
같은 실행에서 다른 파일의 테스트가 51초 멈춤에서 막 풀린 직후(08:04:38 → 08:04:41)라 **멈춤의 여파일 가능성**과
**`buildToc()` 쌍둥이 결함**(메모리 `mdv-ci-red-2026-09-15`: 09-15 수정이 `rebuildSourceModeToc`만 고쳤고 쌍둥이는 열림)을 경쟁 가설로 둔다.

1. `markdown.js:717 buildToc` / `:759 rebuildSourceModeToc` / `editor.js:402 refreshSourceModeToc`에서 활성 항목을 계산하는 입력
   (스크롤 위치·헤딩 오프셋·geometry)을 읽고, `#section-6`이 나올 수 있는 경로를 적는다.
2. 그 경로를 **강제하는** 프로브를 만든다(예: geometry를 stale하게 만든 채 rebuild). CI 종료 상태(`#section-6`)가 재현되면 원인 확정.
3. 재현 경로가 앱 결함이면 앱 수정 + 그 조건에서 예전 코드가 죽고 새 코드가 사는 테스트. 테스트 결함이면 테스트 수정.
4. 재현 못 하면 결론 내지 않고, 실패 경로에 입력값 진단(스크롤 위치·오프셋·geometry)을 덧붙여 다음 발생에 대비 — 재실행으로 판정 금지.

1단계 실험의 matrix 16잡이 이 테스트도 16번 돌리므로, 재발 빈도는 거기서 덤으로 얻는다. #61이 어느 잡에서든 실패하면
**그 잡에도 멈춤이 있었는지** 같이 본다 — 멈춤 있는 잡에서만 실패하면 "멈춤의 여파" 가설, 멈춤 없는 잡에서도 실패하면 자체 결함.
10-07 실패는 다른 파일의 51초 멈춤이 풀린 지 약 1초 뒤에 시작했다.

### 2단계 결과 (2026-10-08) — 테스트 결함, 수정
- 경쟁 가설 중 "멈춤 여파"는 1단계 실험에서 기각(#61 실패 3잡 모두 멈춤 없음). `buildToc()` 쌍둥이도 아님 — 소스 모드는 `rebuildSourceModeToc` 경로.
- 원인: `toggleSource`의 `requestAnimationFrame(focusEditor)`. 새로 넣은 textarea 값은 커서가 끝에 있어 `focus()`가 `#scroll-area`를 커서까지
  스크롤한다. CI의 느린 프레임에서 이 포커스가 테스트의 `scrollTop = 0` **뒤**에 실행돼 화면이 문서 중간으로 밀렸다.
- 강제 프로브: rAF를 붙잡았다가 고정 뒤에 풀면 `#section-5`, `scrollTop` 363(창 높이에 따라 구간이 달라짐, CI는 `#section-6`).
  같은 800ms 지연에서 고친 순서는 `#toc-rebuild-doc`, `scrollTop` 0.
- 수정: 두 소스 모드 목차 테스트에서 위치를 고정하기 전에 `document.activeElement?.id === 'source-editor'`를 기다린다(저장소에 이미 있는 패턴).
  앱 코드 변경 없음. 진입 시 끝으로 스크롤되는 동작 자체는 이번 범위 밖(별도 UX 판단).

## 3. audit fix — 2026-10-11 11:56 KST 이후

`memory-security.md` 2026-10-07 항목대로 plain `npm audit fix`(`--force` 금지). 기대 결과: `source-map-js` 1.2.2, `http-cache-semantics` 4.3.0.
lockfile diff가 그 두 패키지(와 직접 부모)만 건드리는지 확인, `npm audit --audit-level=high` 0건 확인, unit/controller/Electron 통과 → PR → `memory-security.md` PENDING 항목 정리.
쿨다운 경고("left at a vulnerable version because a fix is newer than the release-age cutoff")가 나오면 시각 계산을 다시 확인.

## 4. Electron 44.7.0 패치 업그레이드 — 2026-10-15 04:26 KST 이후

44.4.5 → 44.7.0(같은 메이저, Chromium·V8 보안 백포트 포함). 1단계가 기각으로 끝났다면 이 업그레이드가 후보 (a)를 겸한다 —
업그레이드 PR의 CI를 1단계와 같은 matrix로 8회 돌려 멈춤 횟수를 비교. 패키징 확인은 worktree에서 실제 `npm ci` 후(메모리: symlink된 node_modules는
electron-builder가 무시). 44.7.0 이후 더 새 패치가 나와도 쿨다운을 지난 것 중 최신을 쓴다.

## 5. 보안 재감사 — `/security-audit`

마지막 전체 감사 2026-09-17(재감사 96/100, M1·M2 수정 확인됨). 이후 바뀐 공격면: Electron 44, js-yaml 5 + Gitea식 프론트매터 렌더러(#33·#34·#35),
대화상자 시작 폴더(#31), PR 리뷰 봇 워크플로와 새 secret(#36). 결과는 `security-report.md`·`memory-security.md` 점수 이력에.
high 이상이 나오면 릴리스 전 수정, 그 이하는 Ian 판단.

## 6. 릴리스 당일 — RELEASING.md 순서 그대로

RELEASING.md 상단 박스 3개(cask `depends_on macos: ">= :ventura"`, README/README.ko 최소 macOS 한 줄, develop 최신 `test-electron` 확인)
+ 본문 1~7단계(`npm version 1.4.0 --no-git-tag-version` → develop→main PR → 태그 → 릴리스 노트 `gh release edit` → tap 확인).
README 버전 문자열은 자동 갱신되지 않음(메모리 `mdv-homebrew-distribution`). 업데이트 배너 실기 확인은 메모리 `mdv-update-banner-live-test` 순서.
머지·태그 푸시는 auto mode가 막을 수 있으므로 Ian이 실행할 명령을 정확히 건넨다.

## 일정 요약

| 단계 | 가장 빠른 착수 | 의존 |
|---|---|---|
| 1 멈춤 실험 | 즉시 | — |
| 2 목차 #61 | 즉시(1과 병행 가능, 다른 파일) | 1의 matrix 결과를 재발 빈도로 활용 |
| 3 audit fix | 10-11 11:56 KST | — |
| 4 Electron 44.7.0 | 10-15 04:26 KST | 1이 기각이면 후보 (a)로 겸함 |
| 5 보안 재감사 | 3·4 머지 후 | 의존성이 확정된 뒤에 봐야 의미 |
| 6 릴리스 | 1~5 완료 후 | 1의 결론이 "열림"이어도 RELEASING 박스 규칙에 따라 진행 가능 — Ian 판단 |
