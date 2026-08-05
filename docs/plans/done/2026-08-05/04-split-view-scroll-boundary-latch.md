# 04. 분할뷰에서 스크롤 경계(최상단/최하단) 도달 시 반대 방향 스크롤 전까지 먹통

## 상태
**완료** (2026-08-05, Ian 실사용 재확인) — 2026-07-30에 "네이티브 브라우저 래칭"으로 잠정 결론 냈던 것을 2026-08-04에 Ian이 실사용 중 재현(한쪽으로 스크롤하다 바로 반대 방향으로 스크롤하면 무반응)해 **그 결론을 뒤집었다** — 앱 코드의 실제 결함이었다. 아래 "확정된 원인" 절 참고. 근본 수정을 `src/renderer/editor.js`에 적용, 유닛 테스트 추가 완료 ([`docs/self-check-request.md`](../self-check-request.md) 4번 항목, 요청 2026-07-22). 2026-08-05에 Ian이 원래 보고 조건(한쪽 스크롤 후 즉시 반대 방향 스크롤)으로 실기기에서 직접 재확인해 해소를 확인했다.

## 문제
분할뷰(소스+미리보기 좌우 배치)에서 스크롤 중 한쪽 패널이 최상단/최하단에 도달한 뒤 같은 방향으로 계속 스크롤해도 반응이 없고, 반대 방향으로 한 번 스크롤해야 다시 정상적으로 스크롤된다. 사용자는 "화면 끝에 도달했음에도 스크롤 이벤트가 누적 기록되는 것 아니냐"고 추측했다.

## 근거
- `src/renderer/editor.js:224-228` (`getScrollRatio`) / `:230-233` (`setScrollRatio`) / `:235-240` (`syncSplitScroll`) — 매 스크롤 이벤트마다 **절대값**으로 `scrollTop`을 읽고(`element.scrollTop / maxScroll`) 절대값으로 씀(`maxScroll * ratio`). 델타나 누적값을 들고 있는 변수는 없다.
- `src/renderer/editor.js:105` — 재진입 방지 플래그 `syncingSplitScroll` 하나만 별도 상태로 존재(시간 기반 디바운스가 아니라 `requestAnimationFrame` 한 프레임짜리 플래그).
- `src/renderer/editor.js:422-423` — `refs.content`와 `refs.sourceView`의 `scroll` 이벤트에서 서로를 `syncSplitScroll`로 동기화.
- `grep -rn "wheel|deltaY|overscroll" src/` → **0건**. 휠 델타를 누적하거나 `preventDefault`로 네이티브 스크롤을 가로채는 코드가 앱 어디에도 없다.
- `getScrollRatio`(`:225-226`)는 `maxScroll <= 0`일 때 0을 반환하는 가드가 있어 NaN이 발생하지 않는다.
- `src/renderer/index.html:621` — 분할뷰의 `#scroll-area.split-mode`는 `overflow: hidden`이고, 실제 스크롤 컨테이너는 `#content`(`:632` 계열)와 `#source-view`(`:646` 계열) 각각의 `overflow-y: auto`다. 어디에도 `overscroll-behavior`가 선언되어 있지 않다.

## 원인 (2026-07-30 시점, 이후 뒤집힘 — 아래 "확정된 원인" 참고)
앱 코드에서 스크롤 델타를 누적하거나 경계에서 값을 클램프하지 못해 "반대로 스크롤해야 풀리는" 상태를 만드는 메커니즘은 **발견되지 않았다**. 증상(경계에서 래칭되고, 반대 방향으로 스크롤해야 풀림)은 다음 네이티브 동작과 정확히 일치한다: Chromium이 휠 제스처를 하나의 스크롤러에 "래칭"시킨 뒤, 그 스크롤러가 경계에 도달해도 관성(모멘텀)이 소진되거나 스크롤 방향이 바뀔 때까지 입력을 계속 그 스크롤러로 보내는 동작. `#content`/`#source-view` 모두 `overscroll-behavior`가 없어 오버스크롤이 상위로 체이닝되지 않고 해당 패널 안에 그대로 갇힌다.

**부가로 발견된 사소한 결함(당시엔 경계 래칭의 원인이 아니라고 판단해 하드닝만 했던 것 — 아래에서 재검토):**
1. `editor.js:239`의 `requestAnimationFrame` 재진입 가드 — 프로그래밍적 `scrollTop` 대입이 다음 프레임에 `scroll` 이벤트를 큐잉하는데, rAF는 그 전에 플래그를 이미 해제해 에코백 동기화가 한 프레임 새어나갈 수 있다(A→B→A 진동, 1-2프레임 내 자체 감쇠).
2. `editor.js:224`/`:230`의 비율 계산이 1.0을 넘을 수 있다(정수 반올림된 `scrollHeight - clientHeight` vs 소수인 `scrollTop`) — 대상 쪽에서 클램프되어 반대편이 약 0.5px 스냅백, 자체 감쇠.

## 확정된 원인 (2026-08-04, Ian이 직접 재현)
Ian이 "한쪽으로 스크롤하다가 바로 반대 방향으로 스크롤하면 무반응"이라는 정확한 재현 조건을 보고하면서, 위 "네이티브 래칭" 결론이 틀렸다는 것이 확인됐다. 실제 원인은 2026-07-30에 적용했던 **타깃-아이덴티티 가드(`echoScrollSource`) 자체의 설계 결함**이었다.

`echoScrollSource`는 "마지막으로 프로그래밍적으로 쓴 대상 하나"만 기억하는 단일 슬롯 플래그였다. 휠 제스처(특히 macOS 모멘텀 스크롤)는 한 번의 사용자 동작에 대해 수십 건의 `scroll` 이벤트를 연속으로 발생시킨다 — "이벤트 1건당 무장 1회"라는 전제가 실제 입력 패턴과 맞지 않았다:
1. `content`에서 실제 스크롤 이벤트 1 발생 → `sourceView`에 값을 쓰고 `echoScrollSource = sourceView`로 무장.
2. `sourceView`의 에코가 도착하기 전에 `content`에서 실제 스크롤 이벤트 2가 또 발생(같은 제스처의 다음 델타) → `sourceView`에 다시 값을 쓰고 재무장(이미 `sourceView`였으므로 겉보기엔 그대로).
3. 이제 `sourceView`에서 에코 이벤트가 (이벤트 1, 2 각각의 쓰기에 대응해) 두 번 도착한다 — 첫 번째는 정상적으로 무장 해제되며 드롭되지만, **두 번째는 플래그가 이미 풀린 상태라 "진짜 스크롤"로 오인**되어 `syncSplitScroll(sourceView, content)`가 실행되고, `content`가 이 값으로 다시 쓰이며 `echoScrollSource = content`로 무장된다.
4. 사용자가 바로 이어서 `content`를 반대 방향으로 스크롤하면, `syncSplitScroll(content, ...)`이 `echoScrollSource === content`를 보고 이를 **자신이 방금 쓴 에코로 오인해 그대로 드롭** — 사용자의 진짜 반대 방향 스크롤이 무시된다. 이것이 "반대로 스크롤해야 풀리는" 것이 아니라 "반대로 스크롤한 첫 시도가 씹히는" 정확한 증상이다.

즉 원래 설계("어느 쪽이 마지막으로 쓰였는지"만 기억하는 불리언 플래그)는 이벤트가 정확히 1:1로 쓰기-에코 쌍을 이룰 때만 안전하고, 버스트 상황에서는 역할이 뒤집힐 수 있었다. `docs/plans/done/2026-07-30/`로 넘어간 하드닝 자체의 코드 주석("무장은 대상 쪽 스크롤이 실제로 변했을 때만")도 "다음 진짜 스크롤을 먹는 함정"을 이미 알고 있었지만, 그 함정을 막은 방식(변경 여부 체크)이 이 버스트-역할반전 케이스까지는 막지 못했다.

## 수정 (2026-08-04, 적용 완료)
`src/renderer/editor.js`에 값 기반 에코 판별로 교체했다 — 존재 여부/신원(identity) 대신 **정확히 어떤 값을 마지막으로 썼는지**를 판별한다.
- `getScrollRatio`/`setScrollRatio` 근처에 `createSplitScrollSync()` 팩토리를 module scope에 추가. 내부적으로 `WeakMap<대상 엘리먼트, 마지막으로 쓴 scrollTop>`을 들고 있다.
- `sync(sourceElement, targetElement)`: `sourceElement.scrollTop`이 자신에 대해 마지막으로 기록된 쓰기 값과 (1px 이내로) 일치하면 에코로 간주해 드롭. 아니면 실제 스크롤로 간주해 `targetElement`에 비율을 쓰고, 그 결과값을 `targetElement`의 새 기록으로 남긴다.
- 이 방식은 몇 건의 에코 이벤트가 도착하든 상관없다 — 값이 안 바뀐 채로 도착하는 에코는 몇 번이든 계속 같은 기록과 일치해 드롭되고, 값이 달라지는 진짜 스크롤은 그 즉시 불일치로 통과한다. 기존 방식처럼 "무장된 쪽에서 오는 스크롤은 크기와 무관하게 전부 드롭"하는 함정이 구조적으로 없다.
- `createEditorController`의 `syncSplitScroll`은 이제 이 팩토리의 얇은 래퍼다. `setSplitMode`에서 분할뷰를 나갈 때 `splitScrollSync.reset()`을 호출해 다음 세션에 기록이 새지 않게 한다(기존 동작 유지).

## 제안 방안
> 아래 1~2순위는 2026-07-30 시점 계획의 역사적 기록이다. 원인이 확정되고 수정이 적용된 지금은
> 재현 판별 실험이 더 이상 필요하지 않다 — 위 "확정된 원인"/"수정" 절 참고.

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
- `src/renderer/editor.js` — 값 기반 에코 판별(`createSplitScrollSync`)로 근본 수정 **적용 완료** (2026-08-04). 2026-07-30의 클램프(`[0,1]`)와 모듈 스코프 이동은 그대로 유지, 타깃-아이덴티티 가드(`echoScrollSource`)만 값 비교 방식으로 교체.
- `tests/unit/editor.test.js` — 클램프 유닛 테스트 6건(2026-07-30, 유지) + `createSplitScrollSync`의 버스트/에코/리셋 시나리오 유닛 테스트 5건 추가 **완료** (2026-08-04).
- `src/renderer/index.html` — 미변경(`overscroll-behavior` 미적용, 아래 리스크 참고).

## 테스트 계획
- 클램프: `tests/unit/editor.test.js`에 `{scrollHeight, clientHeight, scrollTop}` 스텁 기반 6건 완료 — 0/중간/1 매핑, 하단 소수 오버슈트(`scrollTop: 500.4` → `1`), 음수 입력, 스크롤 불가 엘리먼트(0 division 회피), 비율 1.0 초과 대입, 경계에서의 왕복 안정성.
- `createSplitScrollSync`: 순수 팩토리 함수라 실제 레이아웃 없이 스텁만으로 검증 가능(2026-07-30 당시 "jsdom에 레이아웃이 없어 의미 있는 검증 불가"로 남겨뒀던 제약이 이번 리팩터로 해소됨). 추가한 5건 — ① 기록 없는 소스의 스크롤은 실제로 간주, ② 방금 쓴 값과 일치하는 에코는 드롭, ③ 한 소스에 대한 버스트(연속 2회 실제 쓰기) 이후 대상의 지연 에코가 도착해도 소스의 다음 반대 방향 스크롤이 삼켜지지 않음(Ian의 재현 조건 그대로), ④ 같은 값의 중복 에코가 한 번 잘못 "실제"로 오인되더라도 그 뒤의 실제(다른 값) 스크롤은 막히지 않음, ⑤ `reset()` 이후 이전 세션의 기록이 다음 세션 첫 이벤트를 에코로 오판하지 않음.
- Electron 스모크: 이번 변경 후 `E2E="split view|split"` 케이스를 재확인할 것(아래 테스트 티어 메모 — 전체 스위트는 마무리 전 1회).
- 휠 제스처 관성 자체는 여전히 Playwright 합성 이벤트로 재현되지 않는다(`page.mouse.wheel`에는 관성이 없다) — 이번 수정이 실사용에서 체감상 해결됐는지는 Ian의 재확인이 필요하다(아래 리스크 참고).

## 리스크 / 미결정 사항
- ~~실사용 재확인 필요~~ — 2026-08-05, Ian이 원래 보고 조건(한쪽 스크롤 후 즉시 반대 방향 스크롤)으로 실기기에서 직접 확인해 해소를 검증했다. 더 이상 열린 리스크가 아니다.
- 이번에 고친 것은 에코 판별 로직의 버스트 상황 오판 버그이지, 브라우저/OS 레벨 오버스크롤 체이닝과는 별개다. 실사용 재확인에서 유사 증상이 재발하지 않아, 원인이 이 하나였던 것으로 확정한다.
- **실측 후 재검토 후보(보류, 불필요해짐)**: `#content`/`#source-view`에 `overscroll-behavior: contain` 추가 — 실사용 확인에서 증상이 완전히 해소되어 더 이상 필요하지 않다고 판단. 향후 유사 증상이 다시 보고되면 그때 재검토.
