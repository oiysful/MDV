# 21. Electron 테스트 스위트 전수 조사 — 유효성·중복·규모

## 상태
**조사 완료. 착수 여부는 사용자 결정 대기.** — 2026-09-21.

실행 계획이 아니라 조사 보고서다. 계획 12(i18n 타당성)와 같은 성격이며, "진행한다면 이렇게"
수준의 설계만 담는다. **이 조사에서는 테스트를 하나도 지우거나 병합하지 않았다.**

## 요약 — 세 질문에 대한 답

| 질문 | 답 |
|---|---|
| 전부 유효하고 필요한가 | **대체로 그렇다.** 104건 중 명백히 무용한 것은 1건, 부분 중복이 1건. 죽은 단언·사라진 기능에 대한 단언은 **0건**. `test.skip`/`.only`/`.todo`도 0건. |
| 중복은 없는가 | **있다. 다만 대부분 "같은 로직, 다른 계층"이지 같은 테스트의 복제가 아니다.** 완전 중복은 1건(4줄), 계층 오배치가 6~8건. |
| 규모를 줄일 수 있는가 | **줄일 수 있지만 기대만큼은 아니다.** 부팅이 비용의 55%인데, 현재 구조가 부팅 공유를 구조적으로 막고 있다. 테스트를 지우는 것보다 **리셋 헬퍼를 만드는 것**이 본 작업이다. |

## 비용 구조 — 개수가 아니라 부팅이 문제다

실측(2026-09-21, 이 머신):

| 항목 | 값 |
|---|---|
| 부팅+해체 | **약 570ms/테스트** (콜드 813ms, 이후 407·411ms + teardown 159~180ms) |
| 스위트 총 CPU | 108.6s (`--test-concurrency=2`에서 wall 72.7s) |
| 그중 부팅·해체 | **59.3s = 55%** |
| 동시성 하한 | 총량 제약(합계/2 = 54.3s). 최장 파일 15.8s는 여유 |

**104건 중 63건은 본문이 350ms 미만**이다. 즉 스위트의 3분의 2가 자기 검증보다 앱 부팅에 더 많은
시간을 쓴다.

부팅 공유를 실제로 만들어 재봤다(`boot-and-render` #8+#10):

```
각자 부팅: 1743ms (콜드 포함) / 1270ms (콜드 제외)
공유 부팅:  717ms
실제 검증 비용: fence 34ms + table 15ms = 49ms
```

이 유형은 **비용의 93%가 부팅**이다.

### 파일별 (초, 테스트 수)

```
15.8s(10) boot-and-render     14.7s( 6) session-and-windows   13.2s(10) editor-source-mode
10.9s(14) menu-and-guides      8.7s( 7) file-watching          7.7s( 4) split-view-async
 7.1s( 7) explorer-and-shell   6.2s( 6) split-view-core        5.9s( 6) links-and-toc
 4.3s( 6) security-and-scroll  3.5s( 5) search                 3.4s( 5) keyboard-and-a11y
 3.1s( 5) update-notice        2.8s( 4) tabs                   1.4s( 2) large-directory-watch
```

`session-and-windows`는 6개 테스트에 **13번 부팅**한다. quit→relaunch 자체가 검증 대상이므로
**환원 불가**다. 여기서 절감을 찾지 말 것.

## 규모 축소를 막고 있는 구조적 장벽

이게 이 조사의 가장 중요한 발견이다.

1. **모든 테스트가 `waitForSelector('#empty')`로 시작한다.** 앞 테스트가 탭을 하나라도 남기면
   다음 테스트의 이 대기는 영영 끝나지 않는다.
2. 파일을 열면 `app.js:373-376`이 350ms 디바운스로 `saveSessionState` IPC를 쏘고
   `session.json`이 기록된다. 다만 **진짜 장벽은 인메모리 탭 목록**이다.
3. `tests/electron/helpers/smoke-helpers.js`에 **"모든 탭을 닫고 빈 상태를 복원하는 리셋 헬퍼가
   없다."**

따라서 현재 인프라에서 안전하게 부팅을 공유할 수 있는 그룹은 손에 꼽는다. "부팅이 55%"는
사실이지만, 그것을 회수하려면 **테스트를 지우는 게 아니라 리셋 경로를 만들어야 한다.**

## 무용하거나 중복인 것 — 확인된 목록

### 1. 자기 주석이 무용함을 인정하는 테스트 (1건)

`split-view-core.test.js:55` **"rapid split-view toggling settles into a consistent state
without throwing"** — 주석(L46-54)이 직접 적고 있다:

> this test (which checks final state and absence of thrown errors, not an exact recompute
> count) **cannot distinguish the fixed code from the pre-fix one**. It's kept as a basic
> stability check under rapid, adversarial input; **the leak fix itself is pinned by code
> review, not by this test.**

명목상 지키려던 `transitioncancel` 리스너 누수 회귀를 실제로는 못 잡는다. 남은 가치는 "난폭한
입력에도 안 터진다"는 일반 안정성 확인뿐이다.

### 2. 완전 중복 (1건, 테스트 전체가 아니라 4줄)

`boot-and-render.test.js:636-639`의 내용 단언이 `tests/unit/markdown.test.js:258-264`와
**같은 입력(`` ```\nplain text\n``` ``), 같은 단언**(`code-lang` 부재 / `copyCode` / `copy-btn`)이다.
같은 테스트의 기하 단언(L652-659, wrapper 높이 = pre 높이 + border)은 고유하므로 **테스트 삭제가
아니라 그 네 줄만 정리** 대상이다.

### 3. 계층 오배치 — Electron이 필요 없는데 Electron에서 도는 것

| 테스트 | 왜 Electron이 불필요한가 |
|---|---|
| `keyboard-and-a11y:23` toast aria | `index.html:1488`이 `role="status" aria-live="polite"`로 **정적**. 테스트는 그 두 속성만 읽고 토스트를 발생시키지도 않는다. **선례 있음**: `tests/unit/csp.test.js`가 이미 `fs.readFileSync(index.html)` + 정규식으로 정적 마크업을 unit에서 핀한다 |
| `menu-and-guides:559` 단축키 안내 문구 | 본문(L565-589)이 정적 DOM 문자열만 읽는다. `Menu`·`ipcMain`·`dialog` 어느 것도 건드리지 않는다 |
| `explorer-and-shell:196` 테마 순환 | `theme.js:2`의 `createThemeController`가 `matchMedia`/`storage`/`documentRef`를 **전부 주입받는다**. 이미 컨트롤러 하네스가 있는 `workspace.js`/`explorer.js`와 구조가 같다. **단 이건 공짜 삭제가 아니다** — `theme.js`는 현재 저장소에 unit/controller 테스트가 **하나도 없고**, 이 Electron 테스트가 유일한 커버리지다. 내리려면 먼저 컨트롤러 테스트를 써야 한다 |
| `editor-source-mode:364` wrap 버튼 가용성 | `style.display`/`disabled`만 읽는다. 기하 0 |
| `search:200` 소스 모드 이탈 시 검색 닫힘 | `#search-bar.style.display`만 읽는다. `workspace-search.test.js`가 이미 유사 호출부를 컨트롤러 층에서 덮는다 |
| `split-view-core:14` + `:86` 사이드바 강제 닫기 | 로직 전부가 `unit/editor.test.js`의 `computeSidebarOpenForSplitChange`에 있다. 두 테스트 모두 기하를 읽지 않는다 |

### 4. 중복이지만 진단 가치가 남는 것 (판단 필요)

`keyboard-and-a11y:246` **"mouse: tab and explorer click paths still work after the keyboard
refactor"**. 대조 결과 중복 주장은 **사실이다**:

- 탐색기 nested→child 클릭 시퀀스가 `explorer-and-shell.test.js:70-77`과 거의 글자 단위로 같다.
- 탭 클릭 경로는 `file-watching.test.js:96,121,132,148,243` 다섯 곳이 의존한다.

즉 마우스 경로가 깨지면 **다른 테스트들이 먼저 빨개진다.** 다만 이것을 자명한 삭제 근거로 보지는
않는다 — 없애면 **진단 신호**가 사라진다. 실패 시 "마우스 경로가 깨졌다"고 지목해 주는 테스트가
없어지고, 무관해 보이는 file-watching이 빨개진 뒤 원인을 역추적해야 한다. 트레이드오프다.

### 5. 제목이 약속하는 것보다 약한 것

`menu-and-guides:245`(accelerator 등록)와 `:559`(단축키 안내 문구)는 **서로 교차검증하지 않는다.**
`:559`의 제목은 "advertise the shortcuts **their menu accelerators** provide"라고 약속하지만,
본문은 `Menu.getApplicationMenu()`를 부르지 않는다. 각자 리터럴(`'CmdOrCtrl+B'` vs `'⌘B'`)을
따로 박아둘 뿐이라 **둘이 서로 어긋나는 상황은 아무도 잡지 못한다.** 둘 중 하나에서 값을 끌어와
비교하면 두 테스트가 실제로 한 쌍이 된다.

### 6. 조사에서 뒤집힌 판정 (기록용)

분류 레인이 `links-and-toc:349`(소스 모드 TOC)를 컨트롤러 테스트와 "거의 완전 중복, 최고 신뢰도"로
판정했으나 **대조 결과 틀렸다**:

- 컨트롤러(`source-mode-toc.test.js:86-108`)는 `refreshTocActive(0)`와 `(999)` **두 점만** 본다.
  first/last 이진 구현으로도 통과한다.
- Electron(L376-385)은 **중간 지점**이 "첫 번째도 마지막도 아니어야" 한다고 요구한다. 주석이
  명시한다: *"proves continuous line-position tracking, not just a first/last binary."*

즉 연속 추적을 증명하는 유일한 단언이 Electron 쪽에만 있다. 올바른 조치는 삭제가 아니라
**컨트롤러에 중간 지점 단언을 먼저 추가하는 것**이다.

## 부팅 공유 가능 그룹 — 현 인프라에서

| 그룹 | 구성 | 절감 | 제약 |
|---|---|---|---|
| A | `boot-and-render` #8·#9·#10 | 2부팅 (~1.1s) | #9/#10이 `content.innerHTML`을 덮어써 `#empty`를 파괴한다 → #8을 먼저, 마지막 것 앞에 `page.reload()` |
| B | `update-notice` #1·#3·#4 | 2부팅 (~1.1s) | 같은 파일이라 CI 실패 시 파일명 문제 없음 |
| C | `keyboard:23` + `keyboard:37` + `explorer:196` + `menu:245` + `menu:559` | 4부팅 (~2.3s) | **3개 파일에 걸쳐 있다.** 합치려면 파일을 옮겨야 하고, 그러면 빨간 CI가 가리키는 파일명이 바뀐다. 테마 순환이 먼저 와야 한다(신규 프로필의 `theme==='auto'` 전제) |

`file-watching` 그룹화는 권장하지 않는다 — 7개가 각기 다른 탭/더티 상태로 끝나서, 공유하려면
중간 정리가 필요하고 그 정리 자체에 결함이 있으면 실패를 가린다.

## 현실적인 절감 추정

| 조치 | 절감(부팅) | CPU | wall(동시성 2) |
|---|---|---|---|
| 그룹 A+B+C 공유 | 8 | ~4.6s | ~2.3s |
| 계층 이동 6~8건 | 6~8 | ~4.0s | ~2.0s |
| **합계** | **14~16** | **~8.6s** | **~4.3s** |

전체 108.6s CPU의 **약 8%**다. **극적이지 않다.** 대다수 테스트는 자기 부팅값을 한다.

### 더 큰 절감은 인프라에서 나온다

리셋 헬퍼(`resetToEmptyState(page)`: 모든 탭 닫기 → `#empty` 복원 확인)를 만들면 파일 내부에서
여러 테스트가 한 부팅을 공유할 수 있다. 63개의 "부팅 지배" 테스트가 대상이고, 파일당 2~3 그룹으로
묶으면 **30~40부팅(17~23s CPU)** 회수가 가능해 보인다. 다만 이건 **추정이며**, 테스트별 상태 오염
분석이 선행되어야 한다. 그리고 대가가 있다 — 한 `test()` 안에 여러 검증이 들어가면 **CI 실패 시
어느 검증이 깨졌는지 이름으로 알 수 없게 된다.** 지금은 테스트 이름이 곧 진단이다.

## 권고 (우선순위)

1. **`split-view-core:55`를 어떻게 할지 결정한다.** 자기가 못 잡는다고 적어둔 회귀를 제목에 달고
   있다. 제목을 실제로 하는 일("난폭한 토글에도 상태가 일관되고 예외가 없다")에 맞추거나,
   누수를 실제로 잡는 단언(재계산 횟수)을 추가하거나, 지운다. **지금이 가장 정직하지 않은 상태다.**
2. **`boot-and-render:636-639` 네 줄을 지운다.** unit이 같은 입력으로 같은 단언을 한다. 같은
   테스트의 기하 단언은 남긴다. 부팅 절감은 0이지만 중복은 사라진다.
3. **`menu-and-guides:245`↔`:559`를 실제로 엮는다.** 한쪽이 다른 쪽에서 값을 끌어오면 제목의
   약속이 참이 된다.
4. **그룹 A·B를 공유 부팅으로 묶는다.** 같은 파일 안이라 CI 실패 시 파일명이 바뀌지 않는다.
   4부팅(~2.3s).
5. **계층 이동은 커버리지를 먼저 만든 뒤에.** 특히 `theme.js`는 현재 **어떤 계층에도 테스트가
   없다** — Electron 테스트를 내리기 전에 컨트롤러 테스트를 써야 하고, 그 전에 내리면 순수한
   커버리지 손실이다. 같은 이유로 `links-and-toc:349`는 컨트롤러에 중간 지점 단언을 추가한
   뒤에만 검토한다.
6. **리셋 헬퍼는 별도 계획으로.** 가장 큰 절감이지만 가장 큰 변경이고, "테스트 이름이 곧 진단"을
   일부 포기하는 거래다. 착수 여부를 따로 판단할 문제다.

## 하지 않을 것

- **`--test-concurrency` 조정.** AGENTS.md 131행과 `ci-electron.yml` 주석이 두 번의 오진을
  기록하고 있다. 다시 꺼내면 다섯 번째가 된다.
- **플레이크 수정 결과물 5건에 손대기.** 빨강이면 회귀다:
  - `boot-and-render` "openFile loads markdown…" — **1.8초 경과시간 단언은 의도적이다.**
    게이트 드리프트를 잡는 유일한 수단이고, 더 싼 개수 단언은 실측으로 드리프트를 놓쳤다.
  - `split-view-async` "split view restores fresh preview and pane scroll…"
  - `large-directory-watch` "a pathologically large directory trips the path-count guard…"
  - `menu-and-guides` "default app guide has dialog semantics…"
  - `menu-and-guides` "toggleSidebarFromShortcut skips the toggle…" (`fcd7015`)
- **`session-and-windows` 축소.** 13부팅 전부가 quit→relaunch 자체를 검증한다.
- **`security-and-scroll` 축소.** 6건 전부 main 프로세스 심볼릭 링크/allowlist 또는 실제 스크롤
  기하다. HIGH-1 하드닝의 유일한 커버리지다.

## 조사 방법 (증거)

- 부팅 비용: 빈 본문 테스트 3회 실측.
- 스위트 타이밍: `--test-reporter=tap`의 `duration_ms`를 테스트 제목→파일로 매핑해 집계.
- 부팅 공유: 실제 테스트 둘을 공유 부팅으로 재작성해 측정.
- 분류: 104건 전부를 두 레인이 읽고 (지키는 결함 / 필요한 계층 / 중복 / 상태 변경 여부)로 분류.
  **레인 판정은 표본 검증했고, 그중 하나(`links-and-toc:349`)는 대조 결과 뒤집혔다** — 위 6절.
  이 보고서에서 "중복"이라 적은 것은 전부 내가 양쪽 파일을 직접 대조한 것이다.
