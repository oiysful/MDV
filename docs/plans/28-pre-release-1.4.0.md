# 28. v1.4.0 릴리스 전 정리 — Electron 44 CI 멈춤 실험부터 릴리스 당일까지

## 상태
**진행 중.** 순서는 Ian 승인(2026-10-08): 1 → 2 → 3 → 4 → 5 → 6 → 7. 3단계(소스 모드 진입 위치)는 1·2단계 완료 후 Ian 요청으로 추가(2026-10-08), 기존 3~6은 4~7로 밀림.

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
**기각 시** 다음 후보를 같은 틀로: (a) Electron 44.7.0(쿨다운 10-15 04:26 KST 이후 — 5단계와 합침), (b) 러너 이미지 고정(`macos-14`/`macos-15`),
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

## 3. 소스 모드(⌘U) 진입 시 문서 끝으로 튀는 문제 — 사용자 체감 버그

### 실측 (2026-10-08, 로컬, 30섹션 문서)
| 출발(미리보기 스크롤 비율) | 소스 모드 진입 직후 | 커서 |
|---|---|---|
| 0(맨 위) | **1.00(맨 끝)** | 3176/3176(끝) |
| 0.4 | **1.00(맨 끝)** | 끝 |
| (반대) 소스 0.25에서 이탈 | 미리보기 0.21 | — |

- **진입**: 어디서 들어가든 맨 끝. 커서도 끝이라 바로 타이핑하면 문서 끝에 들어간다 — 읽던 자리에서 고치려는 사용자에게 두 겹으로 틀린 동작.
- **이탈**: `#scroll-area.scrollTop` 픽셀이 그대로 남아 우연히 근처(0.25→0.21)에 떨어질 뿐, 위치 대응은 없다. 문서가 길고 코드블럭·이미지·mermaid처럼
  미리보기/소스 높이 비가 구간마다 다르면 더 벌어진다.

### 원인 (코드로 확인)
1. `editor.js:182 applySourceModeToRefs`가 진입마다 `refs.sourceEditor.value = markdownText` — textarea에 값을 넣으면 커서가 끝으로 간다.
2. `editor.js toggleSource`가 `requestAnimationFrame(focusEditor)` → `focus()`가 커서를 보이게 `#scroll-area`를 끝까지 스크롤.
- 탭 전환(`workspace.js restoreTabState`)은 포커스를 주지 않고 저장된 `scrollTop`을 rAF로 복원하므로 이 문제가 없다. 분할 뷰도 포커스를 주지 않아 해당 없음.
  → **고칠 곳은 ⌘U 토글 경로(진입·이탈) 하나.**

### 설계
**목표**: 미리보기에서 화면 맨 위에 보이던 내용이 소스 모드에서도 화면 맨 위에 오고, 커서는 그 자리(보이는 첫 줄)에 놓인다. 이탈도 대칭.

- **위치 대응은 헤딩을 닻으로 쓴다.** 양쪽 좌표가 이미 있다: 미리보기는 `buildToc()`의 `cachedHeadings`(DOM `offsetTop`), 소스는
  `extractHeadingsFromSource()`의 줄 번호 × `lineHeight`(+ `computeSourceModeGeometry`의 `baseTop`·`paddingTop`).
  **문서 맨 위(0↔0)와 맨 끝(최대 스크롤↔최대 스크롤)을 암묵적 앵커로 추가**하고, 화면 맨 위가 속한 구간(앞 앵커 ~ 뒤 앵커) 안의 비율로
  반대편 같은 구간에 선형 보간. 첫 헤딩 앞·마지막 헤딩 뒤·헤딩 없는 문서도 같은 규칙으로 처리되어 특수 경우가 없고, "맨 위에서 진입하면 0" 이
  구성상 보장된다.
  - 왜 전체 비율이 아니라 헤딩인가: 미리보기와 소스의 높이 비는 구간마다 다르다(코드블럭은 소스가 길고, 이미지·mermaid·표는 미리보기가 길다).
    전체 비율 하나로는 긴 문서 중간에서 수 화면씩 어긋난다. 헤딩은 양쪽에 1:1로 존재하는 유일한 대응점.
  - **짝 맞추기 가정 실측(2026-10-08)**: `extractHeadingsFromSource`는 최상위 h1~h3만 보고(인용문·목록 안 헤딩은 못 봄, 함수 주석에 기록된 한계),
    미리보기 `#content h1,h2,h3`는 중첩까지 본다. 이 저장소 `*.md` 83개(tests 제외)에서 두 목록을 비교 → 83/83 일치. **단 이 측정은 소스 쪽에 전체 텍스트, 미리보기 쪽에 프론트매터를 뗀 본문을 넣었고, 저장소 문서엔 프론트매터가 없어서 프론트매터 문서를 전혀 재지 못했다**(advisor 검토에서 지적). 직접 재 보니 프론트매터는 hr + 문단 + setext `---`로 읽혀 소스 쪽에 가짜 h2가 생겨 **항상 어긋났다** → 3단계 결과에서 수정.
    그래도 중첩 헤딩이 있는 문서는 생길 수 있으므로: 두 목록의 텍스트가 같은 순서로 일치할 때만 헤딩 앵커를 쓰고, 아니면 **암묵적 맨 위·맨 끝
    앵커만**(= 문서 전체 비율)으로 떨어진다 — 틀린 짝을 맞추느니 덜 정확한 쪽.
  - 보간 함수는 순수 함수로 분리해 `tests/unit`에서 검증(앵커 쌍 배열 + 위치 → 반대편 위치).
- **읽기 위치의 캡처와 적용 시점 — 모드에 독립적인 형태로 보관한다.** 헤딩 좌표는 그 창이 보이는 동안에만 유효하다(이 저장소가 이미 겪음:
  `#content`가 `display:none`이면 `offsetTop`이 전부 0으로 무너진다 — `applySourceMode`의 주석, `refreshHeadingOffsets()`가 모드 클래스 전환 **뒤**에
  도는 이유). 그래서 위치를 `{ anchorIndex, fraction }`(몇 번째 앵커 구간의 어디쯤)으로 바꿔 들고 건너간다.
  - **진입(미리보기 → 소스)**: `applySourceMode()` **전에** 미리보기 `cachedHeadings`와 `#scroll-area.scrollTop`으로 캡처(그 호출이 `#content`를
    숨기고, 안의 `refreshSourceModeToc()`가 `cachedHeadings`를 소스 항목으로 덮어쓴다). 적용은 rAF 안, 소스 레이아웃(`autoResizeEditor` 후)이
    확정된 뒤 `computeSourceModeGeometry`로.
  - **이탈(소스 → 미리보기)**: `toggleSource`는 아직 소스 모드인 상태(`#content` 숨김)에서 `render()`를 부르므로 그 직후 `buildToc()`의 오프셋은
    0이다. → **`render()` 전에** 소스 기하(`baseTop`, 줄 위치, `scrollTop`)로 캡처, 적용은 `applySourceMode()` → `refreshHeadingOffsets()`가 끝난 뒤.
  - 이 순서를 코드 주석에도 남긴다(다음 사람이 "render 뒤에 하면 되겠지"로 되돌리지 않게).
- **포커스는 `focus({ preventScroll: true })`** — 스크롤은 우리가 정한 위치로 직접 쓰고, 포커스가 다시 옮기지 못하게.
  rAF로 미루는 것 자체는 유지(레이아웃 확정 후 계산해야 하므로) — 순서는 rAF 안에서 `scrollTop` 설정 → (커서) → `focus({preventScroll})`.
- **줄바꿈(wrap) 모드**: 줄 번호 × `lineHeight`가 성립하지 않는다(기존 TOC·줄 하이라이트도 같은 이유로 꺼짐). → 암묵적 앵커만(전체 비율).

### 결정(Ian, 2026-10-08): 진입 시 커서 = 목차 헤딩, 화면 밖이면 화면 맨 위 줄
- 스크롤 스파이가 강조하는 목차 항목(화면 맨 위 바로 위의 헤딩 — `refreshTocActive`의 `top - 24 <= scrollTop` 규칙, 보간의 앞 앵커와 같은 헤딩)의
  **헤딩 줄 끝**에 커서. 그 헤딩 줄이 화면 위로 벗어났거나(긴 구간 중간) 강조 항목이 없으면(첫 헤딩 앞, 헤딩 없는 문서) **화면 맨 위 줄의 시작**.
  → 어느 경우든 커서가 화면 안이라 첫 키 입력에도 화면이 튀지 않는다.
- Ian이 처음 물은 것: "ToC의 목차 기준으로는 어려울까?" — 가능하고 앵커 계산을 그대로 재사용한다. 단 항상 헤딩이면 긴 구간에서 첫 입력 때 위로
  튀므로 화면 밖 대체를 붙인 조합으로 결정.
- 검증 추가: (a) 헤딩이 화면 안 → `selectionStart`가 그 헤딩 줄 끝, (b) 긴 구간 중간(헤딩이 화면 위 밖) → 화면 맨 위 줄 시작, (c) 첫 헤딩 앞 → 맨 위 줄,
  (d) 어느 경우든 이어서 `keyboard.type` 한 글자 후 `scrollTop` 불변.

#### 결정 전 검토한 선택지(기록)
스크롤 수정과는 **별개의 동작 변경**이라 따로 물었다.
- **현재**: 커서가 항상 문서 끝. 화면에 다 들어오는 짧은 문서에서는 튀는 게 안 보이고, "⌘U → 바로 타이핑"이 **문서 끝에 덧붙이기**가 된다.
- **A(추천)**: 화면 맨 위 줄의 시작으로. 긴 문서에서 "보던 자리에서 바로 고치기"가 된다. 대신 짧은 문서에서 ⌘U → 타이핑이 맨 앞(0번 줄)에
  들어가게 바뀐다 — 지금까지 끝에 덧붙이던 습관과 반대.
- **B**: 커서는 끝에 그대로 두고 스크롤만 고친다. 덧붙이기 습관은 유지되지만, 긴 문서에서 첫 키 입력이 화면 밖(문서 끝)에 들어가고, Chromium이
  그 순간 끝으로 스크롤해 결국 지금과 같은 점프를 타이핑 시점으로 미룰 뿐이다.
- **C**: 화면 안에 문서 끝이 보이면 끝(현재와 같음), 아니면 화면 맨 위 줄. 두 경우를 모두 살리지만 규칙이 하나 더 생긴다.
- 기존 테스트 영향: 소스 모드 진입 후 입력하는 Electron 테스트는 전부 `Meta+a`(전체 선택) 후 입력해 커서 위치에 의존하지 않는다(확인함).
- **이탈(소스 → 미리보기)**: 같은 보간을 역방향으로(위 캡처·적용 시점대로).
- **범위 밖**: 탭별 커서 위치 기억, 분할 뷰 스크롤 동기화(이미 비율 방식으로 동작), 탭 전환 복원.

### 반증 가능한 검증
- **Electron 테스트(신규)**, 헤딩이 많은 긴 문서:
  1. 미리보기를 "Section 12" 헤딩이 화면 맨 위에 오게 스크롤 → ⌘U → 화면 맨 위 근처(±1화면 아님, **±2줄**)의 소스 줄이 `## Section 12`,
     (커서 A·C 채택 시) 커서가 화면 안. **예전 코드에서는 실패해야 한다**(진입 후 비율 1.0) — 수정 전에 먼저 돌려 빨강 확인.
  2. 소스에서 "Section 20" 줄을 맨 위로 → ⌘U(이탈) → 미리보기 화면 맨 위 헤딩이 Section 20(±1 헤딩).
  3. 맨 위(0)에서 진입 → 0에 머문다(가장 흔한 경우의 회귀 방지).
  4. 코드블럭이 긴 구간이 섞인 문서에서 1번 반복 — 전체 비율 방식이었다면 어긋나는 배치로 헤딩 보간의 이유를 고정.
  - 기존 포커스 대기 규칙(AGENTS.md, #61)을 그대로 따른다: 진입 후 `activeElement === source-editor`를 기다린 뒤 측정.
- **단위 테스트**: 보간 함수 — 앵커 사이 선형, 첫 앵커 이전, 마지막 앵커 이후, 앵커 수 불일치 → 비율 대체, 빈 문서.
- **기존 스위트**: 소스 모드에 들어가 스크롤을 고정하는 테스트들(links-and-toc 두 개, editor-source-mode)이 그대로 통과해야 한다 — 이제 진입
  위치가 0 근처라 테스트 의미가 바뀌는 곳이 있으면 테스트를 고치지 말고 먼저 이유를 적는다.
- 수동 확인(Ian): 실제 문서에서 ⌘U 왕복 — 읽던 자리 유지, 바로 타이핑이 보이는 자리에 들어가는지.
- **같은 PR에서 낡게 되는 기록 정리**: `preventScroll` 이후엔 "지연 포커스가 문서 끝 커서로 스크롤한다"가 더는 사실이 아니다 —
  AGENTS.md NOTES의 #61 항목, `links-and-toc` 두 테스트의 주석, 메모리 `mdv-toc-source-mode-deferred-focus`를 고친다. 다만 **포커스 대기 규칙은
  유지**(포커스는 여전히 rAF로 늦게 온다).

### 위험
- 이미지·mermaid가 늦게 렌더되면 이탈 직후 `offsetTop`이 바뀐다. `render()`는 data URL **대입**까지만 await하고 디코드는 기다리지 않는다(advisor 지적 —
  "대부분 안전"은 검증 전 주장이었다). **실측(2026-10-08, 로컬)**: 소스 모드에서 캐시에 없는 새 1200px SVG를 헤딩 바로 위에 넣고 나와도 전환 순간
  `img.complete`, 높이 1202px, 헤딩은 화면 맨 위 1px — 3회 모두 동일. 이미 열린 900px SVG 위 헤딩도 Electron 테스트로 고정. 남는 위험: 큰 래스터 이미지의
  디코드가 전환보다 늦는 경우는 재지 않았다 — 생기면 적용 전에 `img.decode()`를 기다리는 것이 처방.
- `focus({ preventScroll: true })` 이후에도 Chromium이 textarea 내부 스크롤을 건드릴 수 있다 — textarea는 `autoResizeEditor`로 내부 스크롤이
  없으므로(높이 = scrollHeight) 해당 없음을 테스트 1에서 함께 확인.

### 3단계 결과 (2026-10-08)
- 구현: `markdown.js`에 `getPreviewHeadings`(오프셋 갱신 후 반환)/`getSourceHeadings`, `editor.js`에 순수 함수 `buildAnchorTops`·`captureReadingPosition`·
  `resolveReadingPosition`·`headingDepthsMatch`·`computeSourceCaret`, `toggleSource`는 전환 전 캡처 → `applySourceMode()` 후 적용, `focusEditor`는 `preventScroll`.
  분할 뷰 → 소스 전환과 탭 전환 복원은 범위 밖(그대로).
- 짝 판정은 텍스트가 아니라 **개수 + 깊이**(엔티티 디코딩 차이로 `A &amp; B`가 어긋나는 것을 피함).
- 새 Electron 테스트 `source-mode-position.test.js` 4건 — 수정 전 코드에서 **올바른 이유로** 실패 확인(진입이 351행=끝, 맨 위 진입도 7309px,
  이탈이 Section 25 대신 Section 7). 첫 실행은 `createTempMarkdown`이 내용 아닌 경로를 받는 설정 오류였고 메시지를 읽어 걸러냄.
- 단위 테스트 5건. 변형 검증: 화면 밖 판정 제거 → 단위 실패, 앵커 재생을 전체 비율로 교체 → Electron 3/4 실패(맨 위 진입은 어느 쪽이든 0이라 통과가 맞음).
- "긴 구간 중간에서 헤딩이 화면 위 밖" 경우는 이 문서 구성의 소스 쪽에서 만들기 어려워(긴 구간이 소스에선 한 줄) 단위 테스트로 검증.
- **advisor 완료 검토 후 추가**: 프론트매터 문서는 소스 쪽 가짜 h2 때문에 짝이 항상 어긋났다(소스 모드 목차에도 "title: …" 항목이 뜨던 기존 결함) →
  `extractHeadingsFromSource`가 미리보기와 같은 `extractFrontmatter()`로 본문만 읽고 줄 번호엔 뗀 줄 수를 더함. 단위 1건 + Electron 1건(프론트매터 + 헤딩 위
  900px 이미지, 진입·이탈 양방향). 수정을 되돌리면 새 Electron 테스트가 실패함을 확인.
- 전체: unit 273 / controller 13 / Electron 118 통과(프론트매터 수정 후 재측정).

## 4. audit fix — 2026-10-11 11:56 KST 이후

`memory-security.md` 2026-10-07 항목대로 plain `npm audit fix`(`--force` 금지). 기대 결과: `source-map-js` 1.2.2, `http-cache-semantics` 4.3.0.
lockfile diff가 그 두 패키지(와 직접 부모)만 건드리는지 확인, `npm audit --audit-level=high` 0건 확인, unit/controller/Electron 통과 → PR → `memory-security.md` PENDING 항목 정리.
쿨다운 경고("left at a vulnerable version because a fix is newer than the release-age cutoff")가 나오면 시각 계산을 다시 확인.

## 5. Electron 44.7.0 패치 업그레이드 — 2026-10-15 04:26 KST 이후

44.4.5 → 44.7.0(같은 메이저, Chromium·V8 보안 백포트 포함). 1단계가 기각으로 끝났다면 이 업그레이드가 후보 (a)를 겸한다 —
업그레이드 PR의 CI를 1단계와 같은 matrix로 8회 돌려 멈춤 횟수를 비교. 패키징 확인은 worktree에서 실제 `npm ci` 후(메모리: symlink된 node_modules는
electron-builder가 무시). 44.7.0 이후 더 새 패치가 나와도 쿨다운을 지난 것 중 최신을 쓴다.

## 6. 보안 재감사 — `/security-audit`

마지막 전체 감사 2026-09-17(재감사 96/100, M1·M2 수정 확인됨). 이후 바뀐 공격면: Electron 44, js-yaml 5 + Gitea식 프론트매터 렌더러(#33·#34·#35),
대화상자 시작 폴더(#31), PR 리뷰 봇 워크플로와 새 secret(#36). 결과는 `security-report.md`·`memory-security.md` 점수 이력에.
high 이상이 나오면 릴리스 전 수정, 그 이하는 Ian 판단.

## 7. 릴리스 당일 — RELEASING.md 순서 그대로

RELEASING.md 상단 박스 3개(cask `depends_on macos: ">= :ventura"`, README/README.ko 최소 macOS 한 줄, develop 최신 `test-electron` 확인)
+ 본문 1~7단계(`npm version 1.4.0 --no-git-tag-version` → develop→main PR → 태그 → 릴리스 노트 `gh release edit` → tap 확인).
README 버전 문자열은 자동 갱신되지 않음(메모리 `mdv-homebrew-distribution`). 업데이트 배너 실기 확인은 메모리 `mdv-update-banner-live-test` 순서.
머지·태그 푸시는 auto mode가 막을 수 있으므로 Ian이 실행할 명령을 정확히 건넨다.

### 7a. 리뷰 봇을 `claude[bot]`으로 전환 — v1.4.0 릴리스 PR에 함께 싣는다 (Ian 결정, 2026-10-08)
**왜 지금 `github-actions`인가**: `claude-review.yml`이 `github_token: GITHUB_TOKEN`을 넘기기 때문(액션 faq "Why aren't comments posted as
claude[bot]?" — 넘긴 토큰의 신원으로 코멘트가 달린다; `bot_name`/`bot_id`는 git 커밋 작성자에만 쓰여 코멘트 이름을 못 바꾼다). 넘긴 이유는 계획 27:
Claude App 경로는 OIDC 교환 시 **워크플로가 기본 브랜치(main)와 글자 하나까지 같아야** 하는데 main은 릴리스 전용이라 아직 그 파일이 없다.

**검토하고 버린 대안**(2026-10-08, Ian과 논의):
- main에 같은 내용을 직접 넣기 — 임시 저장소 실측으로 같은 내용이면 이후 develop→main 머지가 충돌 없이 합쳐지지만(양쪽이 다르게 고치면 충돌),
  "main은 릴리스 PR로만" 규칙의 예외이고, develop에서 워크플로를 고칠 때마다 다음 릴리스까지 리뷰가 401이라 예외가 반복될 길을 연다.
- 워크플로만 담은 1.3.1 hotfix — develop엔 이미 v1.3.0 이후 전부가 있어 hotfix 브랜치 + 체리픽(같은 규칙 예외), 태그 푸시가 앱 빌드·Release·cask를 돌려
  사용자에게 **변경 없는 업데이트 배너**, main 1.3.1 vs develop 1.4.0의 `package.json` 버전 충돌로 되머지 절차 추가.
- 직접 만든 GitHub App(`<이름>[bot]`) — 기본 브랜치 제약은 없지만 App 개인키라는 장기 secret이 는다. 이름 하나에 비해 보안 비용이 크다.

**절차**
1. (릴리스 전, develop) `claude-review.yml`에서 `github_token` 줄 삭제, `permissions`에 `id-token: write` 추가(App 경로의 OIDC에 필요 — 액션 faq "OIDC
   authentication errors"). 주석의 "App 경로를 안 쓰는 이유"를 "릴리스로 main과 동일해진 뒤 App 경로" 로 갱신. `--edit-last` 지시는 그대로 둬도 되고,
   `use_sticky_comment: true`로 바꿀지는 4번에서 결정.
   - **이 PR 자신과 이후 릴리스 전까지의 develop PR 리뷰는 401로 실패한다**(main에 아직 같은 파일이 없으므로) — 예상된 실패, 필수 체크 아님.
     그래서 이 변경은 **릴리스 PR 직전**, develop에 마지막으로 들어가는 PR로 한다.
2. (Ian, 1번 전 아무 때나) Claude GitHub App 설치: https://github.com/apps/claude → `oiysful` → **Only select repositories: `oiysful/MDV`**.
   설치만으로는 아무것도 바뀌지 않는다(워크플로가 `github_token`을 넘기는 동안은 App 토큰을 쓰지 않음).
3. v1.4.0 develop→main 머지로 main과 develop의 워크플로가 같아짐 → 그다음 develop 대상 PR부터 `claude[bot]`으로 달리는지 확인. 실패하면 로그에서
   `Workflow validation failed`(내용 불일치) / OIDC 오류(`id-token` 누락) / 설치 범위를 순서대로 본다.
   - 릴리스 PR(develop→main) 자체의 리뷰는 PR 쪽 워크플로가 main과 다를 수 있어 실패할 수 있다 — 무시.
4. (선택) `@claude` 코멘트 재리뷰(issue_comment는 main의 워크플로로 돈다 → 이제 가능), `use_sticky_comment`. 켤지는 그때 Ian 결정.
5. AGENTS.md "PR auto-review" 항목, CONTRIBUTING(.ko) 한 줄("comments from `github-actions[bot]`"), 메모리 `mdv-pr-review-bot` 갱신.
- **이후 규칙**: 워크플로를 develop에서 고치면 다음 릴리스까지 develop PR 리뷰가 실패한다 — 고칠 일이 생기면 릴리스 직전에 몰아서.

## 일정 요약

| 단계 | 가장 빠른 착수 | 의존 |
|---|---|---|
| 1 멈춤 실험 | 즉시 | — |
| 2 목차 #61 | 즉시(1과 병행 가능, 다른 파일) | 1의 matrix 결과를 재발 빈도로 활용 |
| 3 소스 모드 진입 위치 | 즉시(4를 기다리는 동안) | — |
| 4 audit fix | 10-11 11:56 KST | — |
| 5 Electron 44.7.0 | 10-15 04:26 KST | 1이 기각이면 후보 (a)로 겸함 |
| 6 보안 재감사 | 4·5 머지 후 | 의존성이 확정된 뒤에 봐야 의미 |
| 7 릴리스 | 1~6 완료 후 | 1의 결론이 "열림"이어도 RELEASING 박스 규칙에 따라 진행 가능 — Ian 판단 |
| 7a 리뷰 봇 `claude[bot]` 전환 | 릴리스 PR 직전(develop 마지막 PR) | Ian의 Claude App 설치(아무 때나) |
