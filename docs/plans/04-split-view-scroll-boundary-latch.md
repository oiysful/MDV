# 04. 분할뷰에서 스크롤 경계(최상단/최하단) 도달 시 반대 방향 스크롤 전까지 먹통

## 상태
**조사 완료, 실사용 확인 필요** — 하드닝(2순위)은 2026-07-30 적용 완료, 경계 래칭 자체의 원인 판별은 사람이 직접 하는 (a)/(b) 실험 결과 대기 ([`docs/self-check-request.md`](../self-check-request.md) 4번 항목, 요청 2026-07-22)

## 문제
분할뷰(소스+미리보기 좌우 배치)에서 스크롤 중 한쪽 패널이 최상단/최하단에 도달한 뒤 같은 방향으로 계속 스크롤해도 반응이 없고, 반대 방향으로 한 번 스크롤해야 다시 정상적으로 스크롤된다. 사용자는 "화면 끝에 도달했음에도 스크롤 이벤트가 누적 기록되는 것 아니냐"고 추측했다.

## 근거
- `src/renderer/editor.js:224-228` (`getScrollRatio`) / `:230-233` (`setScrollRatio`) / `:235-240` (`syncSplitScroll`) — 매 스크롤 이벤트마다 **절대값**으로 `scrollTop`을 읽고(`element.scrollTop / maxScroll`) 절대값으로 씀(`maxScroll * ratio`). 델타나 누적값을 들고 있는 변수는 없다.
- `src/renderer/editor.js:105` — 재진입 방지 플래그 `syncingSplitScroll` 하나만 별도 상태로 존재(시간 기반 디바운스가 아니라 `requestAnimationFrame` 한 프레임짜리 플래그).
- `src/renderer/editor.js:422-423` — `refs.content`와 `refs.sourceView`의 `scroll` 이벤트에서 서로를 `syncSplitScroll`로 동기화.
- `grep -rn "wheel|deltaY|overscroll" src/` → **0건**. 휠 델타를 누적하거나 `preventDefault`로 네이티브 스크롤을 가로채는 코드가 앱 어디에도 없다.
- `getScrollRatio`(`:225-226`)는 `maxScroll <= 0`일 때 0을 반환하는 가드가 있어 NaN이 발생하지 않는다.
- `src/renderer/index.html:621` — 분할뷰의 `#scroll-area.split-mode`는 `overflow: hidden`이고, 실제 스크롤 컨테이너는 `#content`(`:632` 계열)와 `#source-view`(`:646` 계열) 각각의 `overflow-y: auto`다. 어디에도 `overscroll-behavior`가 선언되어 있지 않다.

## 원인 (미확정)
앱 코드에서 스크롤 델타를 누적하거나 경계에서 값을 클램프하지 못해 "반대로 스크롤해야 풀리는" 상태를 만드는 메커니즘은 **발견되지 않았다**. 증상(경계에서 래칭되고, 반대 방향으로 스크롤해야 풀림)은 다음 네이티브 동작과 정확히 일치한다: Chromium이 휠 제스처를 하나의 스크롤러에 "래칭"시킨 뒤, 그 스크롤러가 경계에 도달해도 관성(모멘텀)이 소진되거나 스크롤 방향이 바뀔 때까지 입력을 계속 그 스크롤러로 보내는 동작. `#content`/`#source-view` 모두 `overscroll-behavior`가 없어 오버스크롤이 상위로 체이닝되지 않고 해당 패널 안에 그대로 갇힌다.

**부가로 발견된 사소한 결함(경계 래칭의 원인은 아니지만 하드닝 대상으로 함께 기록):**
1. `editor.js:239`의 `requestAnimationFrame` 재진입 가드 — 프로그래밍적 `scrollTop` 대입이 다음 프레임에 `scroll` 이벤트를 큐잉하는데, rAF는 그 전에 플래그를 이미 해제해 에코백 동기화가 한 프레임 새어나갈 수 있다(A→B→A 진동, 1-2프레임 내 자체 감쇠).
2. `editor.js:224`/`:230`의 비율 계산이 1.0을 넘을 수 있다(정수 반올림된 `scrollHeight - clientHeight` vs 소수인 `scrollTop`) — 대상 쪽에서 클램프되어 반대편이 약 0.5px 스냅백, 자체 감쇠.

## 제안 방안
**1순위 — 코드 변경 없이 재현 판별:**
- (a) `editor.js`의 두 `scroll` 리스너를 임시로 주석 처리한 상태에서 동일 증상이 재현되는지 확인 — 재현되면 앱 코드는 무죄, 재현되지 않으면 동기화 로직이 실제 원인.
- (b) 분할뷰가 아닌 일반 미리보기 단독 스크롤에서도 같은 증상이 나는지 확인 — `syncSplitScroll`은 `!splitMode`일 때 즉시 반환하므로, 단독 스크롤에서도 재현되면 네이티브 동작이라는 것이 증명된다.

### 판별 실험 프로토콜 (사람이 직접 실행)
휠 제스처의 관성/래칭은 Playwright의 합성 이벤트로 재현되지 않는다(`page.mouse.wheel`은 관성이 없는 단발 델타를 보낸다). 아래는 실제 트랙패드/휠로 확인하는 절차다. **(b)를 먼저 하라** — 코드를 건드리지 않고 끝날 수 있고, 여기서 재현되면 (a)는 불필요하다.

공통 준비:
1. 스크롤이 최소 3화면 이상 나오는 긴 `.md` 파일을 준비한다(예: `## H` 섹션 120개).
2. `npm start`로 앱을 실행하고 그 파일을 연다.
3. 증상 판정 기준을 고정한다 — "경계에 도달한 뒤 **같은 방향으로** 계속 스크롤 → 무반응, **반대 방향으로 한 번** 스크롤 → 이후 정상". 무반응 구간이 관측되지 않으면 그 조건에서는 미재현으로 기록한다.

**실험 (b) — 단독 미리보기 (코드 변경 없음):**
1. 분할뷰를 열지 않은 기본 미리보기 상태를 유지한다(`⌘\`가 눌리지 않은 상태 = `#scroll-area`가 스크롤 컨테이너).
2. 트랙패드로 문서 최하단까지 관성이 살아있게 빠르게 스크롤한 뒤, 경계 도달 직후 **같은 방향으로 3~5회 더** 스크롤한다.
3. 무반응 여부를 기록한다. 최상단에서도 같은 절차를 반복한다.
4. 판정: **재현되면 앱 코드 무죄가 코드 레벨로 확정된다** — 이 경로에는 `syncSplitScroll`이 관여하지 않는다(`!splitMode` 즉시 반환). 그대로 "네이티브 동작" 결론을 확정하고 (a)는 생략한다.

**실험 (a) — 동기화 리스너 제거 (임시 코드 변경, 커밋 금지):**
1. (b)에서 미재현일 때만 진행한다.
2. `src/renderer/editor.js`의 `bindEditorEvents` 끝부분 두 줄을 주석 처리한다:
   ```js
   // refs.content.addEventListener('scroll', () => syncSplitScroll(refs.content, refs.sourceView))
   // refs.sourceView.addEventListener('scroll', () => syncSplitScroll(refs.sourceView, refs.content))
   ```
   (이 상태에서는 두 패널이 서로 따라가지 않는 것이 정상이다 — 그 자체는 결함이 아니다.)
3. `npm start` → `⌘\`로 분할뷰를 열고, 미리보기 패널과 소스 패널 **각각**에서 위 (b)-2 절차를 반복한다.
4. 판정:
   - 여전히 재현 → 앱 동기화 코드 무죄, 네이티브 래칭 결론 확정.
   - 재현되지 않음 → **동기화 로직이 원인**이다. 이 경우 `syncSplitScroll`의 에코 억제(아래 하드닝의 타깃-아이덴티티 가드)를 의심 1순위로 두고, `#content`/`#source-view` 각각에 `scroll` 이벤트 카운터를 임시로 붙여(예: `console.count`) 경계에서 이벤트가 계속 들어오는데 위치가 안 바뀌는지, 아니면 이벤트 자체가 끊기는지를 구분한 뒤 회귀 테스트를 설계한다.
5. 주석 처리한 두 줄을 반드시 원복한다 — 그 두 줄만 되돌릴 것. `git checkout -- src/renderer/editor.js`는 그 파일의 **다른 미커밋 변경까지 전부 버리므로** 작업 중 변경이 있다면 쓰지 말 것.

**2순위 — 방어적 하드닝(근본 수정 여부는 판별 실험 이후 결정):**
```js
// editor.js:224-233 부근
function getScrollRatio(element) {
  const maxScroll = element.scrollHeight - element.clientHeight
  if (maxScroll <= 0) return 0
  return Math.min(1, Math.max(0, element.scrollTop / maxScroll))
}
function setScrollRatio(element, ratio) {
  const maxScroll = element.scrollHeight - element.clientHeight
  element.scrollTop = maxScroll > 0 ? maxScroll * Math.min(1, Math.max(0, ratio)) : 0
}
```
rAF 재진입 가드를 타깃-아이덴티티 가드로 교체(마지막으로 프로그래밍적으로 쓴 대상을 기억해 그 대상에서 온 다음 한 번의 이벤트만 무시).

### 2순위 적용 결과 (2026-07-30, 완료)
판별 실험 결과와 무관하게 적용한 방어적 하드닝. **경계 래칭 증상 자체를 고치는 변경이 아니다** — 조사 중 함께 발견된 부가 결함 2건을 닫는다.
1. `getScrollRatio`/`setScrollRatio`를 `createEditorController` 클로저에서 **모듈 스코프로 이동**하고 `api`로 export했다. 두 함수는 원래부터 클로저 상태를 쓰지 않는 순수 함수였고, 이 파일에는 이미 순수 헬퍼를 모듈 스코프에 두고 유닛 테스트하는 패턴(`buildLineNumberText`, `computeSidebarOpenForSplitChange` 등)이 있다. 양방향 모두 `[0, 1]` 클램프를 넣어 부가 결함 #2(비율 1.0 초과 → 반대편 ~0.5px 스냅백)를 닫았다.
2. rAF 재진입 가드(`syncingSplitScroll`)를 **타깃-아이덴티티 가드**(`echoScrollSource`)로 교체해 부가 결함 #1(프레임 타이밍 때문에 에코 1건이 새어나가는 A→B→A 진동)을 닫았다. 함정 하나를 함께 처리했다 — 프로그래밍적 대입이 값을 바꾸지 못하면 `scroll` 이벤트가 아예 발생하지 않으므로, 무조건 무장시키면 그 플래그가 남아 사용자의 **다음 진짜 스크롤 1회**를 먹는다. 그래서 `scrollTop`이 실제로 변했을 때만 무장한다. 분할뷰를 나갈 때(`setSplitMode`)는 가드를 초기화한다 — 이전 세션의 에코가 다음 세션 첫 스크롤을 삼키지 않도록.
3. `overscroll-behavior: contain`은 **적용하지 않았다** — 상위 체이닝만 막고 패널 내부 래칭은 해결하지 못할 가능성이 높은데 실측 근거가 없다. 아래 "실측 후 재검토 후보"로 남긴다.

## 변경 파일
- `src/renderer/editor.js` — 2순위 하드닝 (모듈 스코프 이동 + 클램프 + 타깃-아이덴티티 가드) **적용 완료**.
- `tests/unit/editor.test.js` — 클램프 유닛 테스트 6건 추가 **완료**.
- `src/renderer/index.html` — 미변경(`overscroll-behavior` 미적용).
- 경계 래칭 자체의 수정 파일은 판별 실험 결과가 나온 뒤 결정.

## 테스트 계획
- 클램프: `tests/unit/editor.test.js`에 `{scrollHeight, clientHeight, scrollTop}` 스텁 기반 6건 추가 완료 — 0/중간/1 매핑, 하단 소수 오버슈트(`scrollTop: 500.4` → `1`), 음수 입력, 스크롤 불가 엘리먼트(0 division 회피), 비율 1.0 초과 대입, 경계에서의 왕복 안정성(양 패널이 경계에서 서로를 밀지 않음).
- 타깃-아이덴티티 가드: jsdom에는 레이아웃이 없어 `scrollHeight`/`clientHeight`가 항상 0이므로(→ `maxScroll <= 0`) 유닛 테스트로는 의미 있는 검증이 불가능하다. 실질 안전망은 기존 Electron 스모크의 분할뷰 스크롤 동기화 케이스들(`split view restores fresh preview and pane scroll after immediate tab switch` 등)이며, 이번 변경 후 `E2E="split view|split"` 10건 전부 통과 확인했다.
- 휠 제스처 관성 래칭은 Playwright 합성 이벤트로 재현되지 않는다(`page.mouse.wheel`에는 관성이 없다) — 위 판별 실험 프로토콜을 사람이 먼저 수행하고, 앱 코드 문제로 판명되면 그때 회귀 테스트를 설계한다.

## 리스크 / 미결정 사항
- 근본 원인이 네이티브 브라우저/Electron 동작이라면 앱 코드만으로는 완전히 해결되지 않을 수 있다 — 이 경우 "완화"로 기대치를 낮추거나 Electron 버전 업그레이드 시 재확인하는 방향도 고려.
- **실측 후 재검토 후보**: `#content`/`#source-view`에 `overscroll-behavior: contain` 추가. 판별 실험에서 "네이티브 래칭"이 확정된 뒤, 실제 기기에서 이 속성이 체감 증상을 줄이는지 측정한 다음에만 반영한다(측정 없이 넣으면 효과 없는 CSS가 남는다).
- 2순위 하드닝은 위 부가 결함 2건만 닫은 것이고 **사용자가 보고한 경계 래칭 증상은 아직 미해결 상태**다 — 이 항목은 판별 실험 결과가 나올 때까지 "실사용 확인 필요"로 유지한다.
