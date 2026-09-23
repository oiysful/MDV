# 21. Electron 테스트 스위트 전수 조사 — 유효성·중복·규모

## 상태
**조사 완료. 권고 1·2·3 반영 완료(2026-09-21). 권고 4·5·6 + §4 판단 결정 완료(2026-09-23,
Ian) — 아래 "결정" 절.** 남은 작업은 두 건(`theme.js` 단위 테스트, `source-mode-toc` 중간 지점
단언)이고 둘 다 삭제가 아니라 추가다. 그 둘이 들어오면 이 문서는 `done/`으로 옮긴다.

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
| `explorer-and-shell:196` 테마 순환 | `theme.js:2`의 `createThemeController`가 `matchMedia`/`storage`/`documentRef`를 **전부 주입받는다**. 이미 컨트롤러 하네스가 있는 `workspace.js`/`explorer.js`와 구조가 같다. **단 이건 공짜 삭제가 아니다** — `theme.js`는 현재 저장소에 unit/controller 테스트가 **하나도 없고**, 이 Electron 테스트가 유일한 커버리지다. 내리려면 먼저 컨트롤러 테스트를 써야 한다 |
| `editor-source-mode:364` wrap 버튼 가용성 | `style.display`/`disabled`만 읽는다. 기하 0 |
| `search:200` 소스 모드 이탈 시 검색 닫힘 | `#search-bar.style.display`만 읽는다. `workspace-search.test.js`가 이미 유사 호출부를 컨트롤러 층에서 덮는다 |
| `split-view-core:14` + `:86` 사이드바 강제 닫기 | 로직 전부가 `unit/editor.test.js`의 `computeSidebarOpenForSplitChange`에 있다. 두 테스트 모두 기하를 읽지 않는다 |

> **`menu-and-guides:559`는 이 표에서 빠졌다(2026-09-21).** 권고 3을 반영하면서 이 테스트가
> `Menu.getApplicationMenu()`를 읽게 되어 **영구히 Electron에 묶였다.** 의식적인 맞바꿈이다 —
> 이론상 내려갈 수 있는 테스트보다, 실제로 작동하는 교차검증이 낫다.

### 4. 중복이지만 진단 가치가 남는 것 (판단 완료 2026-09-23 — 유지)

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

- 컨트롤러(`source-mode-toc.test.js:103`)는 `refreshTocActive(0)`와 `(999)` **두 점만** 본다.
  first/last 이진 구현으로도 통과한다.
- Electron(L376-385)은 **중간 지점**이 "첫 번째도 마지막도 아니어야" 한다고 요구한다. 주석이
  명시한다: *"proves continuous line-position tracking, not just a first/last binary."*

즉 연속 추적을 증명하는 유일한 단언이 Electron 쪽에만 있다. 올바른 조치는 삭제가 아니라
**컨트롤러에 중간 지점 단언을 먼저 추가하는 것**이다.

> **닫았다(2026-09-23).** `source-mode-toc.test.js:135`가 두 `##` 헤딩 사이 지점에서 중간
> 항목이 활성화되는지 본다. 프로브 오프셋은 픽스처의 헤딩 줄 번호와 하네스의 line-height에서
> **유도**하며(상수 드리프트가 테스트를 조용히 약화시키지 않게), 밴드 경계에서 두 줄 떨어진
> 중점을 찍는다. 반증 확인 결과가 이 절의 주장을 그대로 재현했다 — `markdown.js`를 first/last
> 이진으로 망가뜨리면 **새 단언만 빨개지고 기존 두 점 단언은 통과한다.** Electron 테스트는
> 그대로 남는다: jsdom은 `getBoundingClientRect()`가 0을 주므로 실제 레이아웃(`baseTop`,
> CSS line-height 드리프트)은 컨트롤러 층에서 구조적으로 볼 수 없다.
>
> 같은 파일에 아직 내려오지 않은 요구가 하나 남아 있다 — Electron 테스트는 목차 클릭 **후
> 활성 항목이 따라오는지**도 보는데, 컨트롤러 클릭 테스트는 `scrollTop !== 0`까지만 본다.

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

위 표의 8부팅은 레인이 "안전하다"고 명시한 그룹만 센 것이고, 아래 18부팅은 같은 기준을 파일
전체로 넓혀 집계한 상위 집합이다(그룹 C는 파일 경계를 넘으므로 18에 포함되지 않는다).

### 더 큰 절감은 인프라에서 나온다

**계산된 하한(추정이 아니라 집계):** 104건 중 **26건이 파일을 아예 열지 않는다** — 즉 탭을
남기지 않으므로 리셋 헬퍼 없이도 묶일 수 있는 후보다. 파일 경계를 넘지 않고(=빨간 CI가 가리키는
파일명을 바꾸지 않고) 같은 파일 안에서만 묶으면 **18부팅(~10.3s CPU, 동시성 2에서 ~5.1s)**이
회수된다.

```
파일을 열지 않는 테스트: update-notice 5/5, menu-and-guides 5/14, boot-and-render 4/11,
                       keyboard-and-a11y 4/7, security-and-scroll 4/6, explorer-and-shell 2/7,
                       session-and-windows 1/6, tabs 1/4  =  26/104
```

나머지 78건은 파일을 열기 때문에 **리셋 헬퍼(`resetToEmptyState(page)`: 모든 탭 닫기 → `#empty`
복원 확인)가 있어야** 묶을 수 있다. 그쪽 절감분은 **수치를 내지 않는다** — 테스트별 상태 오염
(테마·wrap·가이드 dismissal·워처 등록) 분석이 선행되어야 하고, 그 분석 없이 낸 숫자는 근거가 없다.

어느 쪽이든 대가가 있다 — 한 `test()` 안에 여러 검증이 들어가면 **CI 실패 시 어느 검증이
깨졌는지 이름으로 알 수 없게 된다.** 지금은 테스트 이름이 곧 진단이다.

## 권고 (우선순위)

> **1·2·3은 2026-09-21에 반영했다** — 무엇을 골랐고 (b)를 왜 기각했는지는 아래 "반영 결과"
> 절에 있다. **4·5·6은 2026-09-23에 결정했다** — 아래 "결정" 절. 이 목록의 항목 문구는
> 조사 당시 그대로 두고, 판정만 덧붙였다.

1. ~~**`split-view-core:55`를 어떻게 할지 결정한다.**~~ **[완료]** 자기가 못 잡는다고 적어둔 회귀를 제목에 달고
   있다. 제목을 실제로 하는 일("난폭한 토글에도 상태가 일관되고 예외가 없다")에 맞추거나,
   누수를 실제로 잡는 단언(재계산 횟수)을 추가하거나, 지운다. **지금이 가장 정직하지 않은 상태다.**
2. ~~**`boot-and-render:636-639` 네 줄을 지운다.**~~ **[완료]** 네 줄 **전부** 대조 확인했다 — `code-lang`
   부재·`copyCode`·`copy-btn`뿐 아니라 `code-meta` 부재까지 `markdown.test.js:261`이 같은
   입력으로 이미 단언한다. 같은 테스트의 기하 단언(L652-659)은 남긴다. 부팅 절감은 0이지만
   중복은 사라진다.
3. ~~**`menu-and-guides:245`↔`:559`를 실제로 엮는다.**~~ **[완료]** 한쪽이 다른 쪽에서 값을 끌어오면 제목의
   약속이 참이 된다.
4. ~~**그룹 A·B를 공유 부팅으로 묶는다.**~~ **[기각 2026-09-23]** 같은 파일 안이라 CI 실패 시
   파일명이 바뀌지 않는다. 4부팅(~2.3s).
5. **계층 이동은 커버리지를 먼저 만든 뒤에.** **[부분 채택 2026-09-23 — 커버리지만 만들고
   이동은 하지 않는다]** 특히 `theme.js`는 현재 **어떤 계층에도 테스트가
   없다** — Electron 테스트를 내리기 전에 컨트롤러 테스트를 써야 하고, 그 전에 내리면 순수한
   커버리지 손실이다. 같은 이유로 `links-and-toc:349`는 컨트롤러에 중간 지점 단언을 추가한
   뒤에만 검토한다.
6. **리셋 헬퍼는 별도 계획으로.** **[보류 2026-09-23 — 재검토 트리거를 숫자로 박았다]** 가장 큰
   절감이지만 가장 큰 변경이고, "테스트 이름이 곧 진단"을
   일부 포기하는 거래다. 착수 여부를 따로 판단할 문제다.

## 반영 결과 (2026-09-21) — 권고 1·2·3

### 권고 1 — `split-view-core:55`: 주석만 고쳤다 (제목·단언 유지)

조사 당시 이 테스트를 "가장 정직하지 않은 상태"로 적었는데, **그 표현이 과했다.** 다시 보니
제목("rapid split-view toggling settles into a consistent state without throwing")은 단언이
실제로 하는 일과 **정확히 일치한다.** 오도하는 것은 주석이었다 — 누수 수정 이야기로 시작해서
"그런데 이건 못 잡는다"로 끝나는 구성이라, 독자가 이 테스트를 누수 가드로 읽게 된다.

그래서 주석을 뒤집었다: 이 테스트가 **실제로 지키는 것**(여섯 번 토글 후 토글 수가 함의하는
상태로 착지하고 렌더러 오류가 없다)을 먼저 말하고, 누수는 역사적 배경으로 내렸다.

**(b) "재계산 횟수를 세는 단언 추가"는 기각했다.** 두 가지 이유다.

1. **기술적으로 막힌다.** `refreshHeadingOffsets` 호출 횟수를 세려면 `markdownController`를
   계측해야 하는데, 그것은 `app.js`의 모듈 스코프 `const`라 페이지에 노출되지 않는다.
   대안으로 검토한 `addEventListener`/`removeEventListener` 균형 측정도 **작동하지 않는다** —
   `setSplitMode`의 `cancelPendingSidebarTransitionListener`가 두 이벤트 타입을 **무조건**
   remove하므로, `transitioncancel` 등록을 막아 회귀를 주입하면 add 6 / remove 12가 되어
   **remove가 add보다 많아진다.** 누수 시그니처가 아니라 계측의 부산물이다.
2. **비례하지 않는다.** `editor.js:191-192`가 이 누수의 결과를 스스로
   "harmless-but-wasteful no-ops"라고 적고 있다. 성능 사소함이지 정확성 결함이 아니다. 여기에
   몽키패치 계측 하네스를 붙이는 것은, 계획 18~20이 세 번에 걸쳐 걷어낸 것과 같은 종류의
   깨지기 쉬운 결합을 도로 들이는 일이다. 게다가 계획 18~20이 고친 테스트들은 **플레이크였고**
   이 테스트는 안정적으로 통과한다 — 실패 계열이 다르면 대응도 달라야 한다.

누수는 `editor.js`가 적어 둔 대로 코드 리뷰가 지킨다. 그 분담을 주석에 명시했다.

### 권고 2 — `boot-and-render:636-639`: 네 줄 삭제

`code-lang`/`code-meta` 부재와 `copyCode`/`copy-btn` 존재 네 줄을 지우고, 그 자리에 이 내용이
`tests/unit/markdown.test.js:258`에서 같은 입력으로 검증된다는 주석을 남겼다. 같은 테스트의
기하 단언(wrapper 높이 = `<pre>` 높이 + 상하 border)은 jsdom이 볼 수 없으므로 그대로 둔다.
부팅 절감은 0이고, 목적은 중복 제거다.

### 권고 3 — `menu-and-guides:245`↔`:559`: 실제로 엮었다

`:559`가 이제 `Menu.getApplicationMenu()`에서 accelerator를 읽어 `toDisplayShortcut()`으로
표시형(`CmdOrCtrl+Shift+O` → `⌘⇧O`)을 **유도한 뒤** DOM 문구와 비교한다. 룩업 테이블이 아니라
실제 변환이다 — 테이블은 하드코딩된 리터럴을 옮겨 놓을 뿐이다.

네 개(⌘B·⌘⇧O·⌘T·⌘O) 전부 유도로 바꿨다. accelerator 리터럴 자체는 ⌘B·⌘⇧O를 `:245`가 이미
핀하므로, `:559`에서는 그것이 덮지 않는 ⌘T·⌘O만 추가로 핀했다. 이 분담이 없으면 "틀린
accelerator와 그에 맞춰 틀린 힌트"가 서로 동의하며 통과해 버린다.

**드리프트를 실제로 잡는지 확인했다.** `main.js`의 좌측 패널 accelerator를 `CmdOrCtrl+B` →
`CmdOrCtrl+K`로 바꾸고(DOM 힌트는 `⌘B` 그대로) 돌리니
`AssertionError: actual '⌘B', expected '⌘K'`로 실패했다. 바꾸기 전에는 양쪽이 각자 리터럴만
보았으므로 이 상황을 **아무도 잡지 못했다.** 확인 후 `main.js`는 되돌렸다.

### 곁다리로 고친 것

`menu-and-guides.test.js`와 `boot-and-render.test.js` 주석에 남아 있던 **이동 전 계획서 경로**
(`docs/plans/19-...`, `docs/plans/20-...`)를 `done/` 경로로 고쳤다. 계획 20에서 경로를 일괄
갱신할 때 `.md` 파일만 훑어서 `.js` 안의 두 건을 놓쳤다.

## 결정 (2026-09-23) — 권고 4·5·6 + §4 판단

네 건 모두 Ian이 결정했다. 셋은 닫히고, 하나는 절반만 남는다.

### 권고 4 — 기각

절감이 CPU 108.6s 중 ~2.3s(**2%**), 동시성 2에서 wall ~1.2s다. `ci-electron.yml` 잡 전체가
~250s이므로 눈에 보이지 않는다. 반대편 대가는 구체적이다 — 그룹 A는 "#8을 먼저, 마지막 것 앞에
`page.reload()`"라는 **테스트 간 순서 의존**을 새로 만든다. 계획 18·19·20이 세 번에 걸쳐 걷어낸
것이 정확히 그 부류(암묵적 순서·고정 지연에 기댄 결합)다. 2%를 위해 플레이크 벡터를 다시
들이는 거래는 성립하지 않는다.

이 보고서 자신의 비용 모델이 같은 결론을 가리킨다 — 문제는 부팅이 55%라는 **구조**이고 그것을
건드리는 것은 권고 6뿐인데, 권고 4는 구조를 그대로 두면서 결합만 늘린다.

### 권고 5 — 부분 채택: 커버리지만 만들고 이동은 하지 않는다

이 권고는 "선행조건 → 이동"이 한 묶음인데 두 반쪽의 가치가 반대다.

- **선행조건은 순이득이다.** `theme.js` 74줄이 빠른 계층에 커버리지 0이다. 실측으로 확인했다 —
  `createThemeController`는 **어떤 테스트에서도 생성되지 않으며**
  `tests/unit/app-runtime.test.js:39`가 `themeController: {}` 빈 스텁을 넘긴다. 그런데 `theme.js:2`는
  `matchMedia`/`storage`/`documentRef`/`getRefs`/`onThemeApplied`를 전부 주입받는다 — 테스트를
  쓰라고 만들어진 모양이다.
- **이동은 손해다.** 6~8건을 내려 ~2s를 얻는 대신 실제 Electron 환경에서의 검증을 잃는다.
  권고 4를 기각한 것과 같은 크기의 절감이다.

따라서 커버리지는 추가하고 Electron 테스트는 그대로 둔다. 권고 5는 "규모 축소" 항목이 아니라
**공백 메우기** 항목으로 재분류된다.

### 권고 6 — 보류, 단 재검토 트리거를 숫자로 박는다

유일하게 구조를 건드리는 항목이지만 이 보고서 자신이 절감 수치를 내기를 거부했다(테스트별 상태
오염 분석 선행 필요). 78개 테스트가 상태를 공유하게 만드는 변경은 계획 18~20이 방금 4건 닫은
플레이크 계열 그 자체다. 그리고 지금 아픈 사람이 없다 — 로컬 wall 72.7s, 전용 CI 잡.

"언젠가"로 남기면 다음 감사가 같은 논의를 처음부터 다시 한다. 그래서 트리거를 적어 둔다:
**Electron 잡이 CI wall 5분을 넘거나, 테스트 수가 150건을 넘으면 착수를 검토한다.**

### §4 판단 — `keyboard-and-a11y:246` 유지

중복은 사실이다(§4의 대조 결과). 그래서 지워도 **커버리지는 줄지 않는다.** 남는 값은 진단
신호뿐인데, 계획 18~20의 교훈이 바로 "실패가 원인을 지목해 주는 값"이다. 없으면 마우스 경로가
깨질 때 무관해 보이는 `file-watching`이 빨개지고 역추적해야 한다. 1부팅(~570ms)에 그 신호를
사는 것은 남는 거래다.

대신 그 테스트 주석에 역할을 명시한다 — "커버리지는 `explorer-and-shell`·`file-watching`이 이미
덮는다, 이 테스트의 값은 실패 시 원인을 지목하는 것이다". 다음 감사가 같은 판정을 다시 하지
않게 하는 것이 목적이다.

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
- "죽은 단언 0건"은 레인 보고를 그대로 받지 않고 표본 검증했다. 가장 썩기 쉬운 자리인
  `boot-and-render.test.js:131-166`의 `REMOVED_GLOBALS`(34개 전역이 `window`에 **없어야** 한다는
  단언)에서 3개(`openFile`·`copyCode`·`switchTab`)를 확인한 결과, 세 이름 모두 `data-command`
  속성과 `app-runtime.js`의 커맨드 맵으로 살아 있고 `window.X =` 할당은 렌더러 17개 파일 어디에도
  **0건**이었다. 즉 "이름만 바뀌어 단언이 공허해진" 상태가 아니라, 인라인 전역 방식으로 되돌아가지
  않았음을 실제로 지키고 있다.
- 분류: 104건 전부를 두 레인이 읽고 (지키는 결함 / 필요한 계층 / 중복 / 상태 변경 여부)로 분류.
  **레인 판정은 표본 검증했고, 그중 하나(`links-and-toc:349`)는 대조 결과 뒤집혔다** — 위 6절.
  이 보고서에서 "중복"이라 적은 것은 전부 내가 양쪽 파일을 직접 대조한 것이다.
