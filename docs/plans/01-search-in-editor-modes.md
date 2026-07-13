# 01. ⌘F가 소스/분할 모드에서 죽은 키

## 문제

소스 모드나 분할 모드에서 ⌘F를 누르면 **아무 일도 일어나지 않는다.** 검색창도 안 뜨고, 브라우저 기본 찾기도 안 뜬다.

```js
// src/renderer/app-runtime.js:343
if (modifier && event.key === 'f') { event.preventDefault(); toggleSearch() }

// src/renderer/app-runtime.js:256-260
function toggleSearch() {
  const editor = getEditorController()
  if (editor.getSourceMode() || editor.getSplitMode()) return   // ← 조용히 사라짐
  return searchController.toggleSearch()
}
```

키를 `preventDefault()`로 삼킨 다음 early-return 한다. **바인딩을 안 한 것보다 나쁘다** — 브라우저 기본 동작까지 막아버리기 때문이다.

근본 원인은 검색 컨트롤러가 미리보기 DOM만 안다는 것이다. `src/renderer/search.js:41`이 `refs.content`(렌더된 프리뷰)에 `TreeWalker`를 돌려 텍스트 노드를 모으고 `<mark>`를 삽입한다. `<textarea>`에는 그런 게 없다.

## 왜 중요한가

분할 모드는 **사람들이 실제로 글을 쓰는 모드**다. 하필 거기서 검색이 없다. 긴 문서를 편집할 때 가장 필요한 기능이 가장 필요한 순간에 없는 셈이다.

## 접근

`search.js`에 **전략 두 개**를 두고 현재 모드로 분기한다. 컨트롤러 경계가 이미 깨끗해서 크게 손댈 게 없다.

1. **프리뷰 전략** (기존): `refs.content`에 `<mark>` 삽입 + `scrollIntoView`.
2. **에디터 전략** (신규): `<textarea>`는 DOM 삽입이 불가능하므로 selection API로 처리한다.
   - `editor.value`에서 매치 위치 목록을 계산 (대소문자 무시).
   - 현재 매치로 이동: `editor.focus()` → `editor.setSelectionRange(start, end)`.
   - 뷰포트로 스크롤: 매치 앞부분의 `\n` 개수 × `lineHeight`로 `scrollTop` 계산. `editor.js#buildLineNumberText`가 이미 같은 방식으로 줄을 센다.
   - 매치 개수는 기존 `#search-count`에 그대로 표시.

분기 지점:

```js
// app-runtime.js — toggleSearch에서 early-return을 제거하고 전략만 고른다
function toggleSearch() {
  const editor = getEditorController()
  const inEditor = editor.getSourceMode() || editor.getSplitMode()
  return searchController.toggleSearch({ target: inEditor ? 'editor' : 'preview' })
}
```

**분할 모드 주의:** 두 pane이 동시에 보인다. 에디터를 검색 대상으로 삼되, 프리뷰 하이라이트는 하지 않는다(디바운스된 재렌더가 `<mark>`를 날려버린다 — `app.js#renderSplitPreview`). 편집 중인 텍스트를 찾는 게 목적이므로 에디터만 대상으로 하는 게 맞다.

**모드 전환 시:** 검색이 열린 채 모드를 바꾸면 하이라이트가 남거나 selection이 깨진다. `editor.js#toggleSource`/`toggleSplitView`에서 `closeSearch()`를 먼저 호출한다. `workspace.js:293-294`가 탭 전환 시 이미 같은 순서를 지키고 있으니 그 패턴을 따른다.

## 파일

- `src/renderer/search.js` — 전략 분기, 에디터 검색 구현
- `src/renderer/app-runtime.js` — `toggleSearch` early-return 제거
- `src/renderer/editor.js` — 모드 전환 시 `closeSearch()`
- `tests/unit/search.test.js` — **신규**. 매치 위치 계산은 순수 함수로 뽑아 단위 테스트 가능하게 한다

## 리스크

- `<textarea>`의 `setSelectionRange`는 포커스가 있어야 시각적으로 보인다. 검색 입력창에 타이핑하는 동안에는 포커스가 검색창에 있으므로, Enter로 다음 매치 이동 시에만 에디터에 포커스를 넘기고 다시 검색창으로 돌려주는 흐름이 필요하다. 이 왕복이 이 작업의 유일한 까다로운 부분이다.
- 찾기·바꾸기(find & replace)는 이 작업 범위 밖이지만, 여기서 만든 매치 위치 목록이 그대로 그 기반이 된다. 확장 가능하게 설계할 것.

## 검증

- 단위: 매치 위치 계산(빈 쿼리, 대소문자, 겹치는 매치, 특수문자).
- e2e (`tests/electron/smoke.test.js`): 소스 모드에서 ⌘F → 검색창 뜸 → 쿼리 입력 → `#search-count`가 맞는 개수 → Enter로 다음 매치 → `selectionStart`가 이동. 분할 모드도 동일.
- 회귀: 프리뷰 모드 검색이 그대로 동작하는지(기존 e2e가 커버).
- 반복 작업 중에는 `E2E="search" npm run test:e2e`로 해당 테스트만.
