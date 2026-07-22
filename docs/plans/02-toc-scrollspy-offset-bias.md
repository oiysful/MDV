# 02. 좌측 목차(TOC) 활성 하이라이트가 실제 스크롤 위치보다 한 항목 뒤처짐

## 상태
요청 ([`docs/self-check-request.md`](../self-check-request.md) 2번 항목, 2026-07-22)

## 문제
문서를 스크롤하거나 TOC 항목을 클릭해 이동했을 때, 좌측 목차의 활성 하이라이트가 실제로 보이는 헤딩이 아니라 그 바로 직전 항목에 머문다. 특히 TOC 클릭으로 이동한 경우 클릭한 항목 자신이 활성화되지 않고 이전 항목이 계속 활성 상태로 남는 것이 가장 눈에 띄는 재현 경로다.

## 근거
- `src/renderer/markdown.js:128-151` (`buildToc`) — `:134`에서 `heading.id = 'h' + index`로 **위치 기반** id를 부여(텍스트 슬러그 없음), `:147`에서 `cachedHeadings`에 `top: heading.offsetTop`을 캐시.
- `src/renderer/markdown.js:220-230` (`hydrateFromDom`, `:226`)와 `:268-272`(`refreshHeadingOffsets`)도 동일하게 `heading.offsetTop`을 사용.
- `src/renderer/markdown.js:244-266` (`refreshTocActive`) — 이진 탐색으로 활성 헤딩을 찾는 로직. `:251`의 비교식 `cachedHeadings[mid].top - 80 <= scrollTop`이 트리거 지점이며, 이진 탐색 자체(`<`/`<=` 사용)는 단조성 기준으로 올바르다.
- `src/renderer/app-shell.js:153-166` (`bindScrollAndResizeHandlers`) — `#scroll-area`의 `scroll` 이벤트에서(rAF로 스로틀) `markdownController.refreshTocActive(scrollArea.scrollTop)`을 호출(`:164`). 즉 비교 기준은 **스크롤 컨테이너(`#scroll-area`) 상대 좌표**다.
- `offsetTop`은 가장 가까운 `position`이 지정된 조상(offsetParent) 기준이다. `src/renderer/index.html`에서 `#layout`(`:355`), `#main-pane`(`:436-441`), `#scroll-area`(`:609`), `#content`(`:632`) 모두 `position`이 지정되어 있지 않다(static) — 즉 헤딩들의 offsetParent는 `body`로 귀결된다.
- 반면 스크롤 기준(`scrollArea.scrollTop`)은 `#scroll-area` 내부 좌표다. `body` 기준 `offsetTop`과 `#scroll-area` 내부 좌표 사이에는 `#scroll-area` 앞에 쌓인 고정 레이아웃 높이만큼 상수 오차가 생긴다: `#layout { padding-top: 48px }`(`:355`) + `#tab-strip`(형제 엘리먼트, `position: sticky; min-height: 46px`, `:443-456`, 문서가 열려 있으면 항상 존재) + `#scroll-area { padding: 22px ... }`(`:609` 부근) ≈ **116px**.
- `markdown.js:140-143`의 TOC 클릭 핸들러는 `heading.scrollIntoView({behavior:'smooth', block:'start'})`로 스크롤 목표를 헤딩 상단(대략 `Y+22`, `#scroll-area`의 패딩만큼)으로 잡는데, `refreshTocActive`의 실제 활성화 트리거는 `Y+36`(≈116px 오차 − 의도된 80px 리드) 부근에서 발생한다. 그 사이 구간에서는 방금 클릭한 헤딩이 아니라 이전 헤딩이 계속 활성 상태로 남는다 — 사용자가 보고한 증상과 정확히 일치.
- 부가 발견: 분할뷰에서 실제 미리보기 스크롤 컨테이너는 `#content`(`src/renderer/editor.js:422`에서 스크롤 리스너 바인딩)인데, 스크롤스파이 리스너는 `#scroll-area`에만 걸려 있다(`app-shell.js:158`) — 분할뷰에서는 TOC 하이라이트가 아예 갱신되지 않는다.

## 원인
`offsetTop`이 `body` 기준으로 캐시되는 반면, 활성 판정은 스크롤 컨테이너(`#scroll-area`) 기준 좌표(`scrollTop`)와 비교된다. 둘 사이의 상수 오차(≈116px)가 의도된 `-80px` 리드 보정을 집어삼켜, 실제 활성화 시점이 헤딩이 뷰포트 상단을 지난 뒤 약 36px 늦게 일어난다.

## 제안 방안
**JS 방식(권장):** `buildToc`(`:147`), `hydrateFromDom`(`:226`), `refreshHeadingOffsets`(`:268-272`) 세 곳에서 `top` 계산을 스크롤 컨테이너 상대 좌표로 바꾼다.

```js
// 현재 offsetParent가 둘 다 body이므로 유효한 뺄셈
top: heading.offsetTop - refs.scrollArea.offsetTop
```

그리고 `:251`의 `-80`을 실제로 의도한 리드 값(예: `-24`, `#scroll-area`의 상단 패딩 22px에 맞춘 근사치)으로 축소한다 — 지금의 `-80`은 사실상 오차를 우연히 부분적으로 상쇄하던 값이었다.

**대안(CSS 한 줄):** `#scroll-area`(`index.html:609`)에 `position: relative`를 추가해 스크롤 컨테이너 자신을 offsetParent로 만든다. `.copy-btn`/`.code-meta`(`:1072-1086`) 등 `#content` 내부에 절대 위치 자손이 있는지 확인했고 전부 static이라 위험은 낮지만, 향후 CSS 변경에 조용히 깨질 수 있어 JS 방식이 더 안전하다.

**분할뷰 갭:** `app-shell.js:158`의 스크롤 리스너를 분할뷰에서는 `#content`에도 바인딩(또는 `#scroll-area`/`#content` 중 현재 보이는 쪽에 동적으로 바인딩)하도록 확장 — 비용이 낮고 같은 `refreshTocActive` 함수를 재사용하므로 이번 수정에 함께 포함하는 것을 제안.

## 변경 파일
- `src/renderer/markdown.js` — `top` 계산 기준 변경, 리드 값 조정.
- `src/renderer/app-shell.js` — 분할뷰 스크롤 리스너 바인딩(선택, 포함 권장).

## 테스트 계획
- `jsdom`은 `offsetTop`/`getBoundingClientRect`에 항상 0을 반환하므로 `tests/unit/markdown.test.js`(jsdom 기반)로는 이 버그를 재현하거나 검증할 수 없다.
- `tests/electron/smoke.test.js`(Playwright, 실제 레이아웃)에 신규 케이스 추가: 여러 헤딩이 있는 문서를 열고 특정 스크롤 위치로 이동한 뒤 `.toc a.active`의 `href`가 실제 뷰포트 상단 근처 헤딩과 일치하는지 확인. TOC 항목 클릭 후 클릭한 항목 자신이 활성화되는지도 함께 검증.

## 리스크 / 미결정 사항
- 새 리드 값(`-24` 등)은 감각적 튜닝값이라 실제 UI에서 재확인이 필요하다.
- CSS 대안(`position: relative`)을 선택할 경우, 이후 `#scroll-area` 내부에 절대 위치 자손이 추가되면 조용히 다시 깨질 수 있다 — JS 방식을 기본으로 권장하는 이유.
- 분할뷰 스크롤 리스너 확장을 이번 범위에 포함할지, 별도 후속 항목으로 분리할지는 착수 시점에 재확인.
