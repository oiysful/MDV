# 04. 분할뷰에서 스크롤 경계(최상단/최하단) 도달 시 반대 방향 스크롤 전까지 먹통

## 상태
요청 — **조사 완료, 재현 판별 필요** ([`docs/self-check-request.md`](../self-check-request.md) 4번 항목, 2026-07-22)

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
- (a) `editor.js:422-423`의 두 리스너를 임시로 주석 처리한 상태에서 동일 증상이 재현되는지 확인 — 재현되면 앱 코드는 무죄, 재현되지 않으면 동기화 로직이 실제 원인.
- (b) 분할뷰가 아닌 일반 미리보기 단독 스크롤에서도 같은 증상이 나는지 확인 — `syncSplitScroll`은 `!splitMode`일 때 즉시 반환하므로(`:236`), 단독 스크롤에서도 재현되면 네이티브 동작이라는 것이 증명된다.

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
rAF 재진입 가드를 타깃-아이덴티티 가드로 교체(마지막으로 프로그래밍적으로 쓴 대상을 기억해 그 대상에서 온 다음 한 번의 이벤트만 무시)하는 것도 검토. `#content`/`#source-view`(`index.html` `:640`/`:649` 부근)에 `overscroll-behavior: contain` 추가는 상위로의 체이닝은 막지만, 패널 내부 래칭 자체는 해결하지 못할 가능성이 있다 — 실측 필요.

## 변경 파일
판별 실험 결과에 따라 결정. 하드닝만 적용할 경우 `src/renderer/editor.js`, `src/renderer/index.html`.

## 테스트 계획
- `tests/unit/editor.test.js`는 스크롤 동기화 경로를 전혀 다루지 않는다(`grep -rn "ScrollRatio|syncSplit" tests/` 0건). 클램프를 포함해 `getScrollRatio`/`setScrollRatio`를 순수 함수로 유지하면 유닛 테스트로 클램프 동작만은 검증 가능.
- 휠 제스처 관성 래칭은 Playwright로 안정적으로 재현하기 어려울 수 있다 — 위 "1순위" 판별 실험을 먼저 사람이 직접 확인하고, 앱 코드 문제로 판명되면 그때 회귀 테스트를 설계한다.

## 리스크 / 미결정 사항
- 근본 원인이 네이티브 브라우저/Electron 동작이라면 앱 코드만으로는 완전히 해결되지 않을 수 있다 — 이 경우 "완화"로 기대치를 낮추거나 Electron 버전 업그레이드 시 재확인하는 방향도 고려.
- 판별 실험 결과가 나오기 전까지 이 항목은 "조사 필요" 상태로 유지하고, 착수 우선순위를 다른 항목보다 낮춘다.
