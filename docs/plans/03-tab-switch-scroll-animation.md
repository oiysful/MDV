# 03. 탭 전환/새 문서 열기 시 불필요한 스크롤 애니메이션

## 상태
요청 ([`docs/self-check-request.md`](../self-check-request.md) 3번 항목, 2026-07-22)

## 문제
열려 있는 문서 사이를 이동(탭 전환, 새 문서 열기)할 때 불필요한 스크롤 애니메이션이 발생한다. 사용자는 이를 "문서 간 스크롤이 공유된다"고 표현했다.

## 근거
**전제 정정 — 스크롤은 이미 탭별로 분리 저장되어 있다:**
- `src/renderer/workspace.js:143-167` (`saveCurrentTabState`) — `:151` `tab.scrollTop`, `:152` `tab.previewScrollTop`, `:153` `tab.sourceScrollTop`을 각각 저장.
- `src/renderer/workspace.js:169-201` (`restoreTabState`) — `:192-193`(`previewDirty` 재렌더 완료 후 복원)과 `:196-199`(매 호출 시 `requestAnimationFrame` 안에서 복원, 소스뷰 스크롤 포함) 두 지점에서 탭별 값을 복원.
- 즉 "공유"라는 진단은 부정확하다 — 상태는 탭마다 분리되어 있다. 사용자가 체감하는 "애니메이션"의 실제 원인은 아래 두 가지다.

**원인 A — CSS `scroll-behavior: smooth`가 절대값 대입까지 애니메이션시킴:**
- `src/renderer/index.html:609-613`:
  ```css
  #scroll-area {
    flex: 1; min-height: 0; overflow-y: auto;
    padding: 22px 52px 80px;
    scroll-behavior: smooth;
  }
  ```
- Chromium에서 `scrollTop` **setter**는 기본적으로 `behavior: auto`로 스크롤하는데, `auto`는 엘리먼트의 computed `scroll-behavior`를 따른다. 따라서 `workspace.js:193`/`:198`의 절대값 대입(`refs.scrollArea.scrollTop = tab.scrollTop || 0`)이 매번 스무스 애니메이션으로 실행된다 — 탭 A(3000px 지점)에서 탭 B(0px)로 전환하면 그 거리 전체가 애니메이션된다.
- 코드베이스 안의 의도된 스무스 스크롤(`app-runtime.js`의 맨 위로 버튼 `scrollTo({top:0, behavior:'smooth'})`, `markdown.js:142` TOC 클릭, `search.js:85` 검색 이동)은 전부 `behavior`를 명시적으로 지정한다 — CSS의 전역 `smooth`에 의존하는 곳은 없으므로 제거해도 회귀가 없다.

**원인 B — 새 탭을 열 때 스크롤 위치가 리셋되지 않음(별개 결함):**
- `src/renderer/workspace.js:373-415` (`createTab`) — `:392`에서 탭 객체의 `scrollTop: 0`은 초기화하지만, 실제 DOM(`refs.scrollArea.scrollTop`)에는 한 번도 쓰지 않는다. 새로 여는 탭이 화면상 같은 스크롤 컨테이너를 재사용하기 때문에, 직전 탭이 스크롤해 둔 위치를 그대로 물려받는다.

## 원인
(A) `#scroll-area`의 `scroll-behavior: smooth`로 인해 탭 복원 시의 절대값 `scrollTop` 대입이 매번 애니메이션된다. (B) `createTab`이 새 문서를 열 때 컨테이너의 실제 스크롤 위치를 리셋하지 않아 이전 탭의 위치를 물려받는다.

## 제안 방안
**(a)** `src/renderer/index.html:612`의 `scroll-behavior: smooth;`를 삭제한다.
(대안: 삭제 대신 복원 지점만 명시적으로 `behavior: 'auto'`를 쓰도록 `refs.scrollArea.scrollTo({ top: tab.scrollTop || 0, behavior: 'auto' })` 형태로 바꿔도 동일한 효과.)

**(b)** `createTab`(`workspace.js:373-415`)에서 초기 `render()` 이후 스크롤 컨테이너를 명시적으로 리셋한다.
```js
refs.scrollArea.scrollTop = 0
refs.content.scrollTop = 0
```

**주의:** 탭별 스크롤 위치 *복원 자체*는 그대로 유지한다 — 이번 수정은 "애니메이션을 없애는 것"이지 "탭 전환 시 항상 맨 위로 리셋하는 것"이 아니다. (b)는 오직 *새로 여는* 탭에만 적용된다.

## 변경 파일
- `src/renderer/index.html` — `#scroll-area`의 `scroll-behavior` 제거.
- `src/renderer/workspace.js` — `createTab()`에 스크롤 리셋 추가.

## 테스트 계획
- CSS 속성 제거는 순수 유닛 테스트로 검증하기 어렵다 — `tests/electron/smoke.test.js`에 케이스 추가: 탭 A를 특정 위치로 스크롤 → 탭 B로 전환 → 다시 A로 복귀 시 `scrollTop`이 저장된 값으로 즉시(추가 프레임 지연 없이) 복원되는지 확인. 필요하면 `getComputedStyle(document.getElementById('scroll-area')).scrollBehavior`가 `'auto'`인지 검증하는 것으로 충분히 단순화할 수 있다.
- 새 탭 오픈 시 리셋: 탭 A를 스크롤한 뒤 새 파일(탭 B)을 열고 `#scroll-area.scrollTop === 0`인지 확인하는 케이스 추가.

## 리스크 / 미결정 사항
- `scroll-behavior: smooth` 제거가 다른 의도된 부드러운 스크롤 UX에 영향을 주는지 코드 감사로는 확인되지 않았으나(의존하는 곳 없음), 실제 UI에서 최종 확인 권장.
