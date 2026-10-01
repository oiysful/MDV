# 23. 전체 창 미세 스크롤 · 본문 최대 폭 · 붙여 쓴 물결의 취소선

## 상태
**진단 완료, 구현 미착수 (2026-10-01).** 세 항목 모두 원인을 실측으로 확정했고, 1·3번은 수정안을
실제 앱(Electron 42.8.0 / Chromium 148)과 marked 9.1.6에서 프로토타입으로 검증했다. 결정이
필요한 것은 두 가지다: **2번의 폭 후보**, **3번의 엄격도(단일 물결 전면 금지 vs 단어 내부만 금지)**.

## 요약

| # | 증상 | 원인 | 수정 | 확신도 |
|---|---|---|---|---|
| 1 | 창 전체가 몇 px 스크롤됨 | mermaid가 `<body>` 끝에 붙이는 `div.mermaidTooltip`(absolute, 높이 6px)이 `100vh` 레이아웃 아래로 삐져나옴 | 툴팁을 `position: fixed`로 고정 (+ 선택: `scrollIntoView({container:'nearest'})`) | **확정** (전/후 실측) |
| 2 | 최대 폭이 좁다 | `#content { max-width: 720px }` 고정 | 폰트 상대 단위(em) + 넓은 블록만 더 넓히는 브레이크아웃 | 결정 필요 |
| 3 | `P0~P4 … 25~40`이 취소선 | marked의 GFM `del` 규칙이 `~` **하나**도 취소선 구분자로 인정 (최신 marked도 동일) | `del` 토크나이저 오버라이드로 단일 `~` 무시 | **확정** (프로토타입 15케이스) |

---

## 1. 전체 창 미세 스크롤 — 확정

### 원인
`html/body`는 `height:100%`, `#layout`은 `height:100vh`라 정상 상태에선 문서 높이가 정확히 창 높이다
(빈 화면 실측: `scrollHeight 800 = clientHeight 800`). 그런데 **flowchart 계열 mermaid 다이어그램을
한 번이라도 렌더하면** mermaid가 다음을 body에 붙이고 **다시는 지우지 않는다**:

```js
// node_modules/mermaid/dist/chunks/mermaid.esm/chunk-YJHQES7P.mjs:118
select("body").append("div").attr("class", "mermaidTooltip")
  .style("opacity", 0).style("position", "absolute") /* top/left 없음 */ .style("padding", "2px") ...
```

`top`이 없는 absolute 요소는 정적 위치(= body의 마지막, 즉 `#layout` 바로 아래 y=800)에 놓이고,
padding 2+2 + border 1+1 = **6px**만큼 문서를 늘린다. 실측:

| 상태 | `documentElement.scrollHeight` | `scrollY` | `#layout` top |
|---|---|---|---|
| 빈 화면 | 800 | 0 | 0 |
| mermaid 포함 문서 렌더 후 | **806** | 0 | 0 |
| 툴바 위에서 휠 | 806 | **6** | **-6** |
| 목차 클릭(`scrollIntoView`) | 806 | **6** | **-6** |

"창 크기와 상관없이"(항상 6px 고정)와 "때가 있어"(그 세션에서 flowchart를 연 뒤에만, 그리고 휠이
본문 밖에 있거나 목차·검색 점프가 일어날 때만 보임)가 둘 다 설명된다. 툴팁은 세션 내내 남으므로
**다이어그램이 없는 문서로 바꿔도 계속 재현된다** — 스크린샷 문서에 다이어그램이 안 보여도 모순은 아니다.

### 스크롤이 일어나는 경로 두 개
1. **휠**: 툴바·탭 줄처럼 스크롤 컨테이너가 아닌 곳에서 휠 → 루트 뷰포트가 스크롤.
2. **프로그램적**: `scrollIntoView()`는 기본적으로 **모든** 스크롤 조상을 움직인다 — 루트 포함.
   호출부 4곳: `app-shell.js:152`(목차), `markdown.js:561`, `search.js:145`(검색 점프), `workspace.js:317`(탭).

### 수정안과 검증
| 안 | 휠 경로 | 프로그램적 경로 | 실측 |
|---|---|---|---|
| **A. `.mermaidTooltip { position: fixed !important; top: 0; left: 0 }`** | 해결(넘침 자체가 사라짐) | 해결 | `scrollHeight 800`, 목차 클릭 후 `scrollY 0` ✅ |
| B. `scrollIntoView({ container: 'nearest' })` | **미해결** | 해결 | 목차 경로 `scrollY 0` ✅ (Chrome 140+ 기능, 우리 Chromium 148) |
| C. `html, body { overflow: clip }` | — | **미해결** | 루트의 overflow는 뷰포트로 전파돼 `hidden`처럼 동작 → 여전히 `scrollY 6` ❌ |

- **A가 본 수정이다.** 넘침을 없애므로 두 경로가 모두 닫힌다. mermaid는 툴팁 위치를 `pageX/pageY`로
  잡는데, 루트가 스크롤되지 않는 앱이므로 `pageX == clientX`라 fixed로 바꿔도 위치가 어긋나지 않는다.
  인라인 스타일이 `absolute`이므로 `!important`가 필요하다.
- **B는 선택적 2차 방어선.** 앞으로 다른 라이브러리가 body에 무언가를 붙여도 목차·검색 점프는 루트를
  건드리지 않게 된다. 하려면 4곳 전부 바꾼다. 테스트에서 `scrollIntoView` 옵션을 단언하는 곳은 없음을
  확인했다(컨트롤러 하네스는 no-op 스텁만 둔다).
- **C는 넣지 않는다** — 실측으로 효과 없음.

### 회귀 테스트
Electron 테스트 1건: flowchart 문서를 열고 `.mermaidTooltip` 부착을 기다린 뒤
`scrollHeight === clientHeight`, 목차 클릭 후 `scrollY === 0`, 툴바 위 휠 후 `scrollY === 0`을 단언.
**현재 코드에서 실패함을 먼저 보이고**(806 / 6) 수정 후 통과를 확인한다.

### 남은 불확실성
다이어그램을 한 번도 열지 않은 세션에서도 재현된다면 **두 번째 원인이 따로 있다**. 이번 프로브는
빈 화면·일반 문서·분할뷰·소스 모드·표·KaTeX·검색 상태를 모두 돌렸고 mermaid 없이는 넘침이 0이었다.

---

## 2. 본문 최대 폭 — 결정 필요

### 현재 값의 위치
`#content { max-width: 720px }` (`index.html:652`), 본문 15px. 같은 숫자를 따로 들고 있는 곳:
- `markdown.js:395-406` — mermaid 오프스크린 렌더 호스트 폭을 `Math.min(720, …)`로 **하드코딩**.
  폭을 바꾸면 다이어그램이 옛 폭으로 그려진다 → `getComputedStyle(#content).maxWidth`에서 읽도록 바꾼다.
- `search.js` 주석, `tests/unit/markdown.test.js:758`의 720 스텁.
- 인쇄/PDF는 `@media print`에서 `max-width: 100%`로 덮으므로 **영향 없음**.

### 측정치 (본문 폰트, 실제 앱 캔버스 측정)
글자 평균 폭: 한글 음절 ≈13px, 한국어 기술 문장(숫자·영문·공백 혼합) 평균 ≈9.0px, 영문 ≈6.8px.

| 폭 | em(15px) | 한국어 혼합 문장 자/줄 | 한글 음절만 | 영문 자/줄 |
|---|---|---|---|---|
| **720px (현재)** | 48em | ~80 | ~55 | ~106 |
| 780px | 52em | ~87 | ~60 | ~115 |
| 900px | 60em | ~100 | ~69 | ~132 |
| 960px | 64em | ~107 | ~74 | ~141 |

### 어떻게 고를 것인가
- **영문 가독성 지침(50–75자, 66자 최적)으로는 720px도 이미 넘는다.** 그러니 "최적 폭"을 하나의
  숫자로 정하는 근거는 산문 쪽에서는 나오지 않는다. 폭을 넓히고 싶은 이유는 산문이 아니라 **표·코드·
  다이어그램**(스크린샷의 표가 셀 안에서 줄바꿈되는 것)이다.
- WCAG 1.4.8의 "CJK 40자" 기준은 띄어쓰기 없는 문자 체계를 전제로 한 수치라 한국어에 그대로 쓰지 않는다.
- 따라서 기준은 둘로 나누는 것이 맞다: **산문 열은 지금과 비슷하게, 넓은 블록만 더 넓게.**

### 후보
| 안 | 내용 | 장점 | 비용/위험 |
|---|---|---|---|
| **A. 단순 확대** | `max-width: min(100%, 60em)` (≈900px) | 한 줄 수정, 단위가 폰트를 따라감 | 산문 줄이 ~100자로 길어짐 |
| **B. 브레이크아웃 (권장)** | 산문 `52em`(≈780px), 표·코드블럭·mermaid·KaTeX 디스플레이는 `72em`(≈1080px)까지, 둘 다 가용 폭으로 상한 | 표/코드가 가장 이득, 산문은 거의 그대로 | 넓은 블록에 `width: min(72em, 100cqi - 여백)` + 음수 margin 중앙 정렬. `#scroll-area`에 `container-type: inline-size` 필요. 복사 버튼 오버레이·검색 가로스크롤·목차 offsetTop 회귀 확인 |
| C. 사용자 설정 | 보기 메뉴에 "본문 폭: 좁게/보통/넓게" | 취향 문제를 사용자에게 | 설정 저장·메뉴·테스트 추가, 범위가 가장 큼 |

- **B를 CSS grid로 구현하지 않는다** — grid 아이템은 마진 상쇄(margin collapse)가 일어나지 않아
  문단·제목 간격이 전부 바뀐다. 음수 margin 방식은 일반 블록 흐름을 유지한다.
- 최소 폭(현재 만족)은 건드리지 않는다: 어떤 안이든 `min(100%, …)`로 좁은 창에서는 지금과 동일.
- 분할뷰는 이미 `max-width: none`이라 영향 없음.

---

## 3. 붙여 쓴 물결의 취소선 — 확정

### 원인
`markedLib.setOptions({ gfm: true })`(`markdown.js:380`)의 GFM 인라인 `del` 규칙:

```js
// marked 9.1.6 lib/marked.cjs:1179
del: /^(~~?)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]|$)/
```

`~~?` — 물결 **하나**도 구분자다. `P0~P4를 기록했다. P1은 25~40개`에서 첫 `~` 뒤가 공백이 아니고
두 번째 `~` 앞도 공백이 아니므로 그 사이 전체가 `<del>`이 된다. **marked 최신 소스(`src/rules.ts`)도
`delLDelim`/`delRDelim`이 `~~?`로 동일**하므로 marked 업그레이드로는 해결되지 않는다.

github.com도 단일 물결 취소선을 렌더하므로 marked가 틀린 것은 아니다. 다만 remark-gfm은 이를
옵션으로 노출한다 — 문서 표현 그대로: *"Single tildes work on github.com, but are technically
prohibited by the GFM spec."* 그리고 `singleTilde: false`로 끌 수 있다. 같은 선택을 MDV에 적용한다.

### 수정 (marked 공식 확장 API)
marked 문서: 토크나이저 오버라이드는 내장 토크나이저와 병합되고, `false`를 반환하면 기본 동작으로 넘어간다.

```js
markedLib.use({ tokenizer: {
  del(src) {
    if (/^~(?!~)/.test(src)) return { type: 'text', raw: '~', text: '~' }  // 단일 ~는 글자
    return false                                                           // ~~는 기본 규칙
  },
}})
```

### 프로토타입 검증 (marked 9.1.6)
| 입력 | 현재 | 수정 후 |
|---|---|---|
| `P0~P4를 기록했다. P1은 25~40개` | `P0<del>P4를 … 25</del>40개` | 그대로 텍스트 ✅ |
| `2~3배와 ~~취소~~ 25~40` | 중첩 `<del>` 오렌더 | `~~취소~~`만 취소선 ✅ |
| `~~진짜 취소~~`, `앞~~뒤~~끝` | 취소선 | 취소선 유지 ✅ |
| `~one~` | 취소선 | **텍스트** (의도된 동작 변경) |
| 표 셀 `25~40` + `~~x~~` | — | 텍스트 / 취소선 ✅ |
| `끝에 물결~`, `\~이스케이프\~`, `[25~40개](x.md)` | — | 텍스트 / 이스케이프 / 링크 텍스트 ✅ |
| `https://example.com/~user/a~b`, `<https://e.com/~u>` | — | 자동 링크 유지 ✅ |
| `` `a~b~c` ``, `~~~`(펜스), `**굵게 1~2**` | — | 코드 / 펜스 / 굵게 유지 ✅ |

### 트레이드오프와 대안
- **트레이드오프**: `~text~`로 일부러 취소선을 쓴 문서는 더 이상 취소선이 안 된다(`~~text~~`로 써야 함).
- **대안(덜 엄격)**: 단어 **내부**의 단일 물결만 거부(앞 글자가 문자·숫자이면 여는 구분자로 인정하지
  않음). 사용자의 두 사례(`P0~P4`, `25~40`)는 모두 단어 내부라 이것으로도 해결되지만, `~one~` 같은 의도적
  사용은 살린다. 대신 규칙이 GitHub과도, remark의 `singleTilde:false`와도 다른 MDV 고유 동작이 된다.
  **미검증** — 선택 시 프로토타입부터.
- **지금 당장의 우회**: `25\~40`처럼 백슬래시 이스케이프(검증 완료).

### 테스트
`tests/unit/markdown.test.js`에 위 표의 케이스를 단위 테스트로 고정. 의도적 회귀(오버라이드 제거)로
실패하는지 확인.

---

## 작업 순서
1. **3번** — 단위 테스트만으로 닫히는 독립 수정. 가장 작다.
2. **1번** — CSS 한 줄 + Electron 회귀 테스트(+ 선택 시 `container:'nearest'` 4곳).
3. **2번** — 폭 결정 후. `markdown.js`의 720 하드코딩 제거를 같은 PR에서.

세 항목 모두 코드 변경이므로 develop 대상 PR로 간다. 단위+컨트롤러는 매 수정마다, Electron 스위트는
마무리 전 1회.

## 출처
- marked 확장/토크나이저 오버라이드: Context7 `/markedjs/marked` — `docs/USING_PRO.md` ("return `false` to fall back")
- marked 최신 `del` 규칙: https://github.com/markedjs/marked/blob/master/src/rules.ts
- remark-gfm `singleTilde`: https://github.com/remarkjs/remark-gfm , https://github.com/micromark/micromark-extension-gfm-strikethrough
- `scrollIntoView({container})` (Chrome 140): https://developer.chrome.com/release-notes/140 , https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView
- 줄 길이 지침: https://baymard.com/blog/line-length-readability , https://en.wikipedia.org/wiki/Line_length
