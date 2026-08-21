# 16. mermaid 렌더링 버그 2건 — 소스 모드 왕복 시 다이어그램 소실, 인쇄/PDF 팔레트 불일치

## 상태
**구현·검증 완료** (2026-08-21). Ian이 보고한 "소스 모드에 들어갔다 나오면 다이어그램이 안 보인다"를
코드 조사로 근본 원인까지 특정했고, 이어서 보고한 "인쇄/PDF에서 다이어그램만 다크 색상"도 같은
성질(mermaid가 그리는 시점의 상태를 SVG에 구워버림)의 별개 버그로 확인해 계획대로 구현했다.
2-c(코드 하이라이트 인쇄 색상)는 보고 범위 밖이었지만, 새 E2E 테스트가 강제하는 조건이라 함께
포함했다(테스트가 `window.print`를 완전히 대체해 실제 `beforeprint`가 발화하지 않으므로, 기존
전역 리스너에 의존한 방식으로는 통과할 수 없었다).

단위 210개(신규 4개: parking/non-parking/레이스/`applyMermaidTheme` 순서) + 컨트롤러 12개 +
Electron 스모크 91개(신규 2개: 소스 모드 왕복 폭 드리프트, 인쇄 팔레트 복원) 전부 통과.

advisor + code-reviewer 리뷰에서 계획서 범위 밖으로 추가 발견해 반영한 것:
- `withPrintPalette`의 복원부가 다크를 하드코딩하지 않고 `themeController.getIsDark()`를 그
  자리에서 다시 읽도록 수정 — 렌더러가 인쇄/PDF 잡 동안 블로킹되지 않으므로(저장 다이얼로그와
  `printToPDF`가 모두 메인 프로세스에 있음), 저장된 테마가 `auto`일 때 인쇄 도중 시스템이 라이트로
  전환되면 하드코딩된 복원이 정반대 방향으로 같은 버그를 재현할 수 있었다.
- `applyMermaidTheme` 호출을 프라미스 체인으로 직렬화 — 테마 토글이 인쇄 잡의 자체 재렌더와
  동시에 발생하면 두 `mermaid.run()` 호출이 같은 노드를 두고 경합할 수 있었다.
- 파킹 중 자리표시자를 주석 노드 대신 원본의 완전한 클론으로 변경 — `data-mermaid-src`와
  `mermaid` 클래스가 남아 있어, 파킹 도중 탭 전환으로 `#content`가 스냅샷되더라도 다음 렌더/테마
  토글에서 자동 복구된다(기존에는 빈 주석만 남아 영구 소실).
- 화면 밖 측정 호스트의 폭 계산에서 도달 불가능한 `isSplit` 분기와 108px 패딩 오차를 제거하고,
  `#scroll-area`의 실제 computed padding을 읽도록 수정.

기존 전역 `beforeprint`/`afterprint` hljs 리스너는 새 `withPrintPalette`와 같은 두 스타일시트를
두고 경합하므로 제거했다 — `main.js` 확인 결과 ⌘P와 메뉴의 "인쇄…"가 모두 `printDoc()`을 거치고
`windowRef.print()`를 직접 호출하는 다른 경로가 없어 안전했다.

알려진 한계(범위 밖으로 남김): E2E 폭-드리프트 단언(`< 2px`)은 폰트 상속 드리프트에는 민감하지만
`tests/fixtures/mermaid.md`의 다이어그램이 너무 작아(~85px) 컨테이너 폭 계산 버그 자체는 잡아내지
못한다. 줄바꿈이 필요할 만큼 긴 라벨의 픽스처를 추가하면 닫을 수 있으나 이번 작업 범위에서는
보류했다.

## Context

1. **소스 모드 왕복 후 다이어그램 소실** — mermaid 다이어그램이 있는 문서를 열면 처음에는 정상
   렌더링되지만, ⌘U로 소스 모드에 들어갔다 다시 렌더 모드로 나오면 다이어그램 자리가 **빈 공간 /
   아주 작은 조각**으로 남는다. (사용자 확인: 소스 모드(⌘U) 왕복, 원본 텍스트가 아니라 빈 공간 —
   즉 SVG는 만들어졌는데 크기가 0에 수렴한 상태.)
2. **인쇄/PDF에서 다이어그램만 다크** — 다크 모드로 열어둔 채 인쇄하거나 PDF로 내보내면 본문은
   라이트인데 mermaid 다이어그램만 다크 팔레트로 남아 어색하다.

두 건은 서로 다른 버그지만 **같은 성질**을 공유한다: mermaid는 CSS를 따라가지 않고, **그리는
시점의 DOM 실측값과 팔레트를 SVG 안에 구워버린다.** 따라서 "언제, 어떤 상태에서 그리느냐"가
곧 결과물이다. 두 수정 모두 그 지점을 다룬다.

---

# 문제 1: 소스 모드 왕복 후 다이어그램이 사라짐

## 근본 원인

mermaid는 자기가 방금 그린 DOM을 실측해서 다이어그램 크기를 정한다.

- `node_modules/mermaid/dist/chunks/mermaid.core/chunk-WYO6CB5R.mjs` 의 `setupGraphViewbox()`:
  `svgElem.node().getBBox()` → `width = sWidth + padding*2` → `configureSvgSize(..., useMaxWidth)`
  → `width="100%"`, `style="max-width: ${width}px"`
- 노드 라벨(`htmlLabels` 기본값 true)은 `<foreignObject>` 안에서 `getBoundingClientRect()`로 측정

`display:none` 서브트리 안에서는 `getBBox()`/`getBoundingClientRect()`가 **0 사각형**을 돌려주므로
결과 SVG는 `style="max-width: 16px"` 정도로 나온다. DOM에는 `<svg>`가 존재하지만 화면에는 사실상
아무것도 안 보인다 — 사용자가 본 "빈 공간 / 작은 조각"과 정확히 일치한다.

그리고 `#content`가 바로 그 `display:none` 서브트리다:

- `src/renderer/editor.js:162` — `applySourceModeToRefs()`가 `refs.content.style.display = sourceMode ? 'none' : ''`
- `src/renderer/editor.js:437-457` — `toggleSource()`는 소스 모드를 빠져나올 때
  `await render(...)`를 **먼저** 호출하고, `sourceMode = !sourceMode; applySourceMode()`로
  `#content`를 다시 보이게 하는 것은 **그 다음**이다.

즉 재렌더 + `mermaid.run()`이 전부 `#content`가 숨겨진 상태에서 끝난다.

추가로 `mermaid.run()`은 렌더 시도 **전에** `element.setAttribute("data-processed", "true")`를
찍는다(`mermaid.core.mjs:1460`). `runMermaidBlocks()`의 선택자가 `.mermaid:not([data-processed])`
이므로, 한 번 망가진 노드는 이후 어떤 렌더 패스에서도 재시도되지 않는다. (테마 토글만이
`rerenderMermaidTheme()`에서 `data-processed`를 지우므로 유일하게 복구되는 경로다.)

### 같은 뿌리를 공유하는 다른 경로 (전부 함께 고쳐짐)

| 경로 | 파일 |
|---|---|
| 소스 → 렌더 복귀 (**보고된 증상**) | `editor.js:450` |
| 소스 → 분할 보기 전환 | `editor.js:485` |
| 소스 모드 탭으로 전환 (`previewDirty`) — 망가진 SVG가 `tab.renderedHTML` 스냅샷에 캐시됨 | `workspace.js:183` |
| 소스 모드에서 인쇄 / PDF 내보내기 | `app.js:354` (`ensurePreviewRendered`) |
| 소스 모드에서 테마 토글 | `markdown.js:402` (`rerenderMermaidTheme`) |

## 수정

`src/renderer/markdown.js`의 `runMermaidBlocks()` **한 곳**에서 닫는다. 컨테이너가 레이아웃되지
않은 경우에 한해, 처리 대상 `<pre class="mermaid">` 노드를 **화면 밖이지만 레이아웃은 되는 호스트**로
잠시 옮겨서 `mermaid.run()`을 돌리고 원위치시킨다. 호출부는 한 줄도 건드리지 않는다.

```js
// 컨테이너가 이미 레이아웃돼 있으면 null을 돌려 기존 경로를 그대로 태운다(무변경).
// 숨겨져 있을 때만 노드를 화면 밖 호스트로 옮기고, 되돌리는 함수를 준다.
function parkNodesForMeasurement(container, nodes) {
  if (container.getClientRects().length) return null
  const doc = container.ownerDocument
  const host = doc.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  // position:fixed + 화면 밖 좌표라 문서 흐름/스크롤바에 영향이 없고, display:none과 달리
  // 레이아웃은 실제로 계산되므로 getBBox()가 진짜 값을 돌려준다.
  // 폭은 숨겨진 #content에서 읽을 수 없으므로(clientWidth가 0) 스크롤 영역 폭으로 대체하고,
  // 그것도 없으면 #content의 max-width(index.html:645)인 720px로 떨어진다.
  const width = container.parentElement?.clientWidth || 720
  host.style.cssText =
    `position:fixed;top:0;left:-10000px;width:${width}px;overflow:hidden;pointer-events:none`
  doc.body.appendChild(host)
  const anchors = nodes.map(node => {
    const anchor = doc.createComment('mermaid')
    node.replaceWith(anchor)
    host.appendChild(node)
    return anchor
  })
  return () => {
    // 앵커의 부모가 이미 사라졌으면 replaceWith()는 그냥 no-op이다 — run()이 떠 있는 사이에
    // 더 새로운 render()가 #content.innerHTML을 갈아엎은 경우가 정확히 그 상황이고,
    // 그때는 이 노드들이 host와 함께 버려지는 게 맞다.
    anchors.forEach((anchor, index) => anchor.replaceWith(nodes[index]))
    host.remove()
  }
}

async function runMermaidBlocks(container) {
  const lib = getMermaidLib()
  if (!lib) return
  const nodes = Array.from(container.querySelectorAll('.mermaid:not([data-processed])'))
  if (!nodes.length) return
  const unpark = parkNodesForMeasurement(container, nodes)
  try {
    await lib.run({ nodes })
  } catch {
    // (기존 주석 유지)
  } finally {
    unpark?.()
  }
}
```

### 폰트 상속은 "측정 후에" 결정한다 (추측으로 코드 넣지 않기)

노드를 `#content` 밖으로 옮기면 `#content pre`(`index.html:1164`) 규칙이 더 이상 매칭되지 않으므로
이론상 `htmlLabels` 실측 크기가 달라질 수 있다. 다만 mermaid는 자기 enclosing div에 config의
`font-family`를 직접 걸고(`appendDivSvgG`), `createUserStyles`가 `#<id>{font-family;font-size}`를
SVG 안에 주입하므로 상속 폰트에 거의 의존하지 않는다.

→ **먼저 폰트 복사 없이 구현**하고, 아래 검증의 드리프트 단언으로 실제로 어긋나는지 본다.
어긋날 때만 호스트를 `#scroll-area` 하위에 붙이거나 파킹 대상 `pre`의 계산 스타일에서
`fontFamily`/`fontSize`를 복사한다. 필요 없는데 넣으면 "왜 있는지 아무도 모르는 코드"가
이 파일에 영구히 남는다.

### `lib.run({ nodes })`를 유지하고 `lib.render(id, src, host)`로 바꾸지 않는 이유

문법 오류가 있는 다이어그램에서 mermaid의 에러 도형이 유지되는지가 갈린다.
`mermaid.core.mjs:1334-1337`을 보면, 파싱 실패 시 mermaid는 컨테이너 안에 **에러 다이어그램을 이미
그려 놓은 채로** `removeTempElements()`에 도달하기 전에 `throw`한다. 즉 에러 SVG가 컨테이너
(= 우리 `<pre class="mermaid">`) 안에 그대로 남는다. 노드를 옮겼다 되돌리는 방식은 그 컨테이너가
계속 우리 `<pre>`이므로 에러 도형이 그대로 따라 들어온다. `lib.render()`로 갈아타면 에러 도형은
호스트에 남고 사용자에게는 원본 텍스트만 보이게 되어 동작이 조용히 바뀐다.

### 이 방식의 안전성

- 이미 보이는 상태(일반 미리보기, 분할 보기, 첫 렌더)에서는 `parkNodesForMeasurement()`가 즉시
  `null`을 반환 → 기존 코드 경로 그대로. 지금 잘 되는 케이스에 회귀 위험이 없다.
- `#content`의 인라인 스타일을 건드리지 않으므로 `applySourceModeToRefs()`와 경합하지 않는다
  (`await` 중에 사용자가 ⌘U를 다시 눌러도 안전).

---

# 문제 2: 인쇄/PDF에서 mermaid만 다크 팔레트

## 근본 원인

`index.html:1268~1308`의 `@media print` 블록은 "다크 모드로 열려 있어도 인쇄는 항상 라이트 값으로
강제"하지만, 그 강제는 **CSS 변수 재정의**로만 이뤄진다:

```css
:root, [data-theme="dark"] { --bg: ...; --text: ...; --code-bg: #f6f8fa; ... }
```

그런데 mermaid는 CSS 변수를 전혀 쓰지 않는다. `theme.js:24-28`과 `markdown.js:398-401`이 이미
적어놓은 대로, **팔레트를 그리는 시점에 SVG 안에 구워 넣는다** — 노드 fill, 엣지 stroke, 라벨
색이 전부 SVG 내부 `<style>`과 presentation attribute로 박혀 있다. 그래서 다크 모드에서 그려진
다이어그램은 인쇄용 라이트 변수를 하나도 따라오지 않고, 하얀 본문 위에 혼자 검은 다이어그램으로
남는다. CSS만으로 되돌리는 것은 (다이어그램 종류마다 색 규칙이 달라서) 사실상 불가능하다.

## 수정

인쇄/PDF **직전에 실제로 라이트로 다시 그리고**, 끝나면 되돌린다. 화면 테마 설정
(`themeController`의 저장값)은 건드리지 않으므로 사용자 입장에서 테마가 바뀌는 일은 없다.

### 2-a. mermaid 테마 전환을 await 가능한 단일 진입점으로 모은다 (`src/renderer/markdown.js`)

지금 `mermaid.initialize({...})` 리터럴은 `app.js:50`과 `app.js:61` 두 곳에 복제돼 있고,
`onThemeApplied` 콜백은 동기라 재렌더를 **기다릴 수 없다.** 인쇄는 "다 그려진 뒤에" 출력해야
하므로 이 쌍을 markdown.js로 모은다 (`getMermaidLib()`/`rerenderMermaidTheme()`가 이미 여기 있다).

```js
const MERMAID_BASE_CONFIG = { startOnLoad: false, securityLevel: 'strict' }

function initMermaidTheme(isDark) {
  const lib = getMermaidLib()
  if (!lib) return
  lib.initialize({ ...MERMAID_BASE_CONFIG, theme: isDark ? 'dark' : 'default' })
}

// mermaid의 테마 전환은 "initialize + 다시 그리기"가 반드시 한 쌍이어야 한다
// (rerenderMermaidTheme 주석 참고). 인쇄/PDF는 그 다시 그리기가 끝난 다음에 출력해야 하므로
// await 가능한 형태로 제공한다.
async function applyMermaidTheme(container, isDark) {
  if (!getMermaidLib()) return
  initMermaidTheme(isDark)
  await rerenderMermaidTheme(container)
}
```

`app.js`는 복제된 리터럴 대신 이걸 쓴다:
- `onMermaidLoaded: () => markdownController.initMermaidTheme(themeController.getIsDark())`
  (이 시점엔 아직 그릴 노드가 없으므로 init만 — 현재 동작과 동일)
- `onThemeApplied: isDark => { ...; void markdownController.applyMermaidTheme($.content, isDark) }`
  (`typeof mermaid !== 'undefined'` 가드는 `getMermaidLib()`가 대신한다)

### 2-b. 인쇄 팔레트 래퍼 (`src/renderer/app-runtime.js`)

`app-runtime.js`는 이미 `markdownController`와 `themeController`를 주입받고 있다.

```js
// index.html의 @media print는 CSS 변수만 라이트로 강제한다. mermaid는 그리는 시점에 팔레트를
// SVG 안에 구워버리므로 그 변수들을 따라오지 않고, 다크 모드에서 뽑은 PDF는 본문만 하얗고
// 다이어그램만 검은 채로 남는다. 인쇄 직전에 실제로 라이트로 다시 그렸다가 끝나면 되돌린다 --
// themeController에 저장된 테마는 건드리지 않으므로 화면 상태와 설정은 그대로다.
async function withPrintPalette(run) {
  // 항상 프라미스를 돌려준다 -- 순서를 보장하는 게 일인 함수가 경로에 따라 값/프라미스를
  // 번갈아 반환하면 호출부가 조용히 어긋난다.
  if (!themeController.getIsDark()) return await run()
  const refs = getRefs()
  await markdownController.applyMermaidTheme(refs.content, false)
  try {
    return await run()
  } finally {
    await markdownController.applyMermaidTheme(refs.content, true)
  }
}

// windowRef.print()는 Electron에서 스톡 Chrome처럼 시스템 다이얼로그로 블로킹하지 않고 자체
// 인쇄 처리로 넘긴 뒤 곧바로 반환한다. 그 반환을 복구 시점으로 삼으면 인쇄 잡이 페이지를 찍기
// 전에 다크로 되돌려버려서 결국 같은 버그가 난다. 복구는 afterprint가 몰고 온다.
async function printDoc() {
  if (ensurePreviewRendered) await ensurePreviewRendered()
  await withPrintPalette(() => new Promise(resolve => {
    let done = false
    const finish = () => { if (done) return; done = true; windowRef.clearTimeout(timer); resolve() }
    // afterprint가 끝내 오지 않는 환경에서도 페이지가 라이트로 굳지 않게 하는 안전망.
    const timer = windowRef.setTimeout(finish, PRINT_RESTORE_TIMEOUT_MS)
    windowRef.addEventListener('afterprint', finish, { once: true })
    windowRef.print()
  }))
}

// exportPdf는 `await api.exportPdf(...)`가 main 쪽 printToPDF 호출을 실제로 감싸므로
// 그대로 `await withPrintPalette(() => api.exportPdf(suggestedName))`면 된다.
```

### 2-c. (선택) 코드 하이라이트도 같은 문제 — 포함 여부는 결정 필요

조사 중 확인한 사항: 사용자가 보고하진 않았지만 **hljs 토큰 색도 동일한 성질**의 문제가 있다.
`theme.js:9-12`는 다크에서 `atom-one-dark` 스타일시트를 켜는데, `@media print`는 그 스타일시트를
끄지 않는다. 그래서 다크 모드 인쇄물은 배경만 `--code-bg: #f6f8fa`로 하얗게 바뀌고 토큰 색은
파스텔(어두운 배경용) 그대로라 대비가 나빠진다.

`theme.js`에서 스타일시트 스왑 3줄을 `applyCodeTheme(isDark)`로 뽑아 export하고(내부적으로
`applyTheme()`가 그대로 호출), `withPrintPalette` 안에서 `themeController.applyCodeTheme(false)` /
`finally`에서 `true`를 부르면 끝난다. **보고 범위 밖이므로 기본 포함하되, 원치 않으시면 빼겠습니다.**

### 알려진 트레이드오프

PDF 내보내기는 저장 다이얼로그와 `printToPDF`가 main 프로세스의 같은 IPC 핸들러 안에 있어서
(`main.js:460-481`), 팔레트 전환이 **다이얼로그가 열리기 전에** 일어난다. 즉 저장 위치를 고르는
동안 뒤편 창의 다이어그램이 잠깐 라이트로 보인다. 없애려면 `export-pdf` IPC를
"경로 선택" / "PDF 쓰기" 두 개로 쪼개야 하는데(preload + main + 테스트 변경), 체감 대비 비용이
커서 이번에는 감수한다.

---

## 변경 파일

- `src/renderer/markdown.js` — `runMermaidBlocks()` 수정 + `parkNodesForMeasurement()` /
  `initMermaidTheme()` / `applyMermaidTheme()` 추가
- `src/renderer/app.js` — 복제된 `mermaid.initialize` 리터럴 2곳을 위 진입점으로 교체
- `src/renderer/app-runtime.js` — `withPrintPalette()` 추가, `printDoc()`/`exportPdf()`에서 사용
- `src/renderer/theme.js` — (2-c 포함 시) hljs 스왑을 `applyCodeTheme()`로 추출·export
- `tests/unit/markdown.test.js`, `tests/electron/boot-and-render.test.js` — 아래 테스트

## 검증

### ⚠️ 기존 E2E 테스트는 문제 1을 잡지 못한다

`tests/electron/boot-and-render.test.js:287`은 `!!document.querySelector('#content .mermaid svg')`
로 **존재 여부만** 본다. 망가진 경우에도 `<svg style="max-width: 16px">`는 존재하므로 통과한다.
새 테스트는 반드시 **기하(크기)를 측정**해야 한다.

### E2E ①: 소스 모드 왕복 (문제 1)

측정 대상은 `getBoundingClientRect().width`가 **아니라** `svg.style.maxWidth`다. mermaid는
`width="100%" style="max-width: Npx"`를 쓰므로 실제 렌더 폭은 `min(창 폭, N)`으로 클램프되고,
다이어그램이 창보다 넓으면 서로 다른 두 렌더가 똑같이 창 폭으로 나와 드리프트가 가려진다.
`N`이야말로 `configureSvgSize`가 `getBBox()` 결과로 써넣은, 검사하려는 바로 그 값이다.

```js
const intrinsicWidth = () => page.evaluate(() =>
  parseFloat(document.querySelector('#content .mermaid svg').style.maxWidth))
```

`emitRendererCommand(electronApp, 'toggleSource')` 헬퍼로 `tests/fixtures/mermaid.md`에 대해:

1. 첫 렌더 후 `intrinsicWidth()` 기록 (`before`)
2. `toggleSource` (소스 모드 진입) → `toggleSource` (렌더 모드 복귀)
3. 새 svg가 나타날 때까지 대기 후 `after` 측정
4. 단언:
   - `assert.ok(after > 100)` — 0에 수렴한 다이어그램이 아님 (**이 버그의 핵심 단언**)
   - `assert.ok(Math.abs(after - before) < 2)` — 화면 밖에서 그려도 크기가 **드리프트하지 않는지**.
     레이아웃 파생 float이므로 `===`가 아니라 허용 오차를 쓴다. 어긋나면 위 "폰트 상속" 절의
     보정을 추가하라는 신호다 (추론이 아니라 측정으로 결정).
5. 콘솔 에러 없음 (기존 테스트의 `consoleErrors` 패턴 재사용)

### E2E ②: 인쇄 팔레트 (문제 2)

버전에 의존하는 색상 상수를 하드코딩하지 않고, **같은 문서의 라이트 렌더 결과와 비교**한다.
mermaid가 SVG 안에 주입하는 `<style>` 텍스트를 지문으로 쓰되, 매 렌더마다 바뀌는 생성 id는
정규화해서 지운다.

```js
// style 요소가 없으면 TypeError 대신 '지문 없음'으로 실패하게 한다.
const styleFingerprint = () => page.evaluate(() => {
  const svg = document.querySelector('#content .mermaid svg')
  const style = svg?.querySelector('style')
  return style ? style.textContent.replaceAll(svg.id, 'ID') : null
})
```

1. `mermaid.md`를 열고 테마를 **명시적으로** 라이트로 맞춘다. `toggleTheme`은
   `auto → light → dark → auto` 순환이고(`theme.js:35`) 기본 저장값이 `auto`(시스템 의존)라
   "한 번 누르면 다크"를 가정하면 안 된다 → `document.documentElement.dataset.theme`이
   원하는 값이 될 때까지 `toggleTheme`을 돌린다. 그 상태에서 `lightPrint = styleFingerprint()`
2. 같은 방식으로 다크로 이동 → `darkPrint = styleFingerprint()`,
   `assert.notEqual(lightPrint, darkPrint)` (지문이 테마를 실제로 구분한다는 사전 확인)
3. `window.print`를 스텁하되, **afterprint를 매크로태스크 뒤로 미룬다.** 이게 이 테스트의 핵심:
   `print()` 반환을 복구 시점으로 삼는 (틀린) 구현에서는 이 지연 동안 다크로 되돌아가므로
   아래 단언이 깨지고, `afterprint` 기반 구현에서만 통과한다.
   ```js
   await page.evaluate(() => {
     window.__atPrint = null
     window.__afterDelay = null
     window.print = () => {
       const fp = () => {
         const svg = document.querySelector('#content .mermaid svg')
         const style = svg?.querySelector('style')
         return style ? style.textContent.replaceAll(svg.id, 'ID') : null
       }
       window.__atPrint = fp()
       window.__atPrintHljsDarkDisabled = document.getElementById('hljs-dark').disabled // 2-c
       setTimeout(() => {
         // 인쇄 잡이 실제로 페이지를 찍는 시점을 흉내낸다 -- 여전히 라이트여야 한다.
         window.__afterDelay = fp()
         window.dispatchEvent(new Event('afterprint'))
       }, 50)
     }
   })
   ```
4. `emitRendererCommand(electronApp, 'printDoc')`
5. 단언:
   - `window.__atPrint === lightPrint` — 인쇄 시점에 라이트 팔레트로 다시 그려졌음
   - `window.__afterDelay === lightPrint` — **지연된 인쇄 잡 시점에도 여전히 라이트**
     (`finally` 기반 구현을 잡아내는 단언)
   - (2-c) `window.__atPrintHljsDarkDisabled === true`
   - `afterprint` 이후 `styleFingerprint() === darkPrint` — 화면은 다크로 **복원**됨
   - `document.documentElement.dataset.theme === 'dark'` — 저장된 테마 설정은 건드리지 않음

### 단위 테스트 (`tests/unit/markdown.test.js`)

기존 `makeSnapshotHarness` / `makeMermaidStub`(`:358`, `:440`) 재사용. jsdom에서는
`getClientRects()`가 항상 빈 배열이라 기본적으로 parking 경로를 탄다.

- **parking 경로**: `mermaid.run()` 스텁 안에서 `nodes[0].parentNode !== refs.content`(= 호스트
  하위)임을 확인하고, `render()` resolve 후 노드가 `refs.content`로 **원래 순서대로** 복귀했는지,
  화면 밖 호스트가 `document.body`에서 제거됐는지 단언
- **비-parking 경로**: `refs.content.getClientRects`를 rect 하나 돌려주도록 스텁 → 렌더 중에도
  노드가 `refs.content`에 그대로 있는지 단언 (보이는 경로가 무변경임을 고정)
- **레이스**: `mermaid.run()` 스텁 안에서 `refs.content.innerHTML = ''`로 앵커를 날려도 예외 없이
  완료되고 호스트가 정리되는지 단언
- **`applyMermaidTheme`**: 스텁의 `initialize` 호출 인자가 `theme:'default'`/`'dark'`로 들어가고,
  이어서 `data-processed`가 지워진 뒤 `run()`이 다시 불리는지(= init과 재렌더가 한 쌍) 단언
- 기존 `:600` 테스트(`mermaidLib.calls[0].length === 1`)가 그대로 통과하는지 확인

### 실행

```bash
npm run test:unit          # 매 수정마다
npm run test:controller    # 매 수정마다
npm run test:electron      # 마무리 전 1회 (~30초)
```

### 수동 확인

`npm start` → `tests/fixtures/mermaid.md` 열기 →
1. ⌘U → ⌘U → 다이어그램이 첫 렌더와 같은 크기로 보이는지
2. 다크 모드에서 PDF 내보내기 → 다이어그램이 본문과 같은 라이트 팔레트인지, 내보낸 뒤 화면은
   다크로 돌아왔는지
3. 소스 모드에서 인쇄/PDF → 다이어그램이 정상 크기로 나오는지 (문제 1 수정이 함께 커버)
