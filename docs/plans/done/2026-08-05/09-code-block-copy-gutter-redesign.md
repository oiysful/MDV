# 09. 코드블럭 헤더/복사버튼 우측 여백(gutter) 재설계 + 아이콘 클리핑 수정

## 상태
**설계 완료, 구현 대기** (2026-08-04) — 사용자와 2차례 확인을 거쳐 구체적인 CSS/HTML 구조까지 확정했으나, 실제 코드 수정은 아직 하지 않았다. 다음 세션에서 이 문서 그대로 구현하면 된다.

## 문제
오늘 코드블럭 헤더를 두 차례 수정했다: (1) `/team`으로 always-reserved `.code-meta` 헤더 줄을 없애고 복사 버튼을 우측상단 절대위치(`position:absolute`) 아이콘으로 통일, (2) 아이콘 배경을 반투명→불투명으로 바꿔 코드 텍스트가 비치는 문제를 고쳤다(커밋 `1c81f31`). 하지만 사용자가 실제로 써보니 근본적인 구조 문제가 남아있었다:
1. 절대위치 오버레이 방식이라, 긴 코드 라인이 가로 스크롤되면 텍스트가 여전히 아이콘 있는 자리 "밑"까지 이어져 있다가 스크롤에 따라 겹쳐 보일 수 있다("레이아웃이 사용성을 저해").
2. 복사 아이콘 자체가 SVG 좌표 버그로 우하단이 살짝 잘려 보인다("복사 아이콘이 잘려보여").
3. 언어(js 등)가 있을 때는 오늘 첫 수정 이전처럼 예약된 헤더 줄로 표현하고 싶다("이번 수정 전처럼 표현").

## 근거 / 원인 (확정)

### 아이콘 클리핑
`src/renderer/markdown.js`의 `copyIcon`과 `src/renderer/app-runtime.js`의 `COPY_ICON`(동일 SVG 문자열이 두 파일에 중복 존재) — `<rect x="4.5" y="4.5" width="8" height="9" rx="1" .../>`가 `viewBox="0 0 13 13"`를 벗어난다. 바닥 모서리가 `4.5+9=13.5`(stroke 절반 포함 시 ~14.15)로 13을 넘어서서 우하단이 약 1px 잘려나간다. `width`는 8로 정상(오른쪽 끝 12.5, 여유 있음) — `height`만 `9→8`로 고치면 정사각형이 되어 두 축 모두 여유 있게 들어간다. `CHECK_ICON`(복사 성공 체크마크)은 좌표가 이미 viewBox 안에 있어 수정 불필요.

### 레이아웃 겹침
`.copy-btn`이 `position: absolute; top:6px; right:6px`로 `#content pre code`(가로 스크롤, `white-space: pre`) 위에 그냥 얹혀있다. 코드 한 줄이 블록 전체 너비를 채우면 그 지점의 텍스트와 시각적으로 겹친다. 구조적 해결책은 겹침이 아예 불가능한 별도 컬럼(형제 요소)을 만드는 것 — 오버레이가 아니라 flex 레이아웃으로 분리.

## 제안 방안 (사용자 승인 완료)

1. 복사 버튼을 절대위치 오버레이가 아니라 **코드 영역과 완전히 분리된 우측 고정폭(40px) 세로 여백(구분선 포함)**에 둔다. 코드의 가로 스크롤 영역 자체가 이 여백을 침범할 수 없는 구조(flex 형제 컬럼)로 만들어서, 어떤 언어/줄 길이든 겹침이 구조적으로 불가능하게 한다.
2. 언어(js 등)가 있을 때만 코드 위에 예약 줄(라벨 행)이 부활한다 — 오늘 첫 수정 이전의 스타일(플레인 텍스트, 배경 칩 없음, `border-bottom: none`)로. 언어가 없으면 그 줄 자체가 없다(현재 동작 유지).
3. 복사 버튼은 계속 아이콘(텍스트 "복사"로 되돌리지 않음) — 사용자가 명시적으로 확인.
4. SVG 아이콘 클리핑 버그(`rect height="9"→"8"`)도 함께 고친다.

### 1. `src/renderer/markdown.js` — `renderer.code` (현재 95-105번째 줄)

`.code-wrapper`를 `.code-body`(본문: 조건부 라벨 줄 + `<pre>`) + `.code-gutter`(고정폭, 복사 버튼) 두 컬럼으로 재구성:

```js
renderer.code = (code, lang) => {
  const langId = lang ? lang.split(/[\s{]/)[0] : ''
  const hl = (langId && hljsLib.getLanguage(langId))
    ? hljsLib.highlight(code, { language: langId }).value
    : hljsLib.highlightAuto(code, autoSubset.length ? autoSubset : undefined).value
  const langRow = langId ? `<div class="code-lang-row"><span class="code-lang">${escapeHtml(langId)}</span></div>` : ''
  const copyIcon = '<svg class="icon-copy" aria-hidden="true" width="12" height="12" viewBox="0 0 13 13" fill="none"><rect x="4.5" y="4.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 10.5V2.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  return `<div class="code-wrapper"><div class="code-body">${langRow}<pre><code class="hljs">${hl}</code></pre></div><div class="code-gutter"><button class="copy-btn" type="button" data-command="copyCode" data-command-element="true" title="코드 복사" aria-label="코드 복사">${copyIcon}</button></div></div>`
}
```
(`.code-lang` span 클래스명은 그대로 유지 — 기존 유닛 테스트가 `class="code-lang"` 문자열을 찾는다.)

### 2. `src/renderer/index.html` — CSS (현재 1090-1140번째 줄, 통째로 교체)

```css
.code-wrapper {
  position: relative; margin: 1.2em 0;
  border-radius: 12px; overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
  background: color-mix(in srgb, var(--bg) 84%, transparent);
  display: flex; align-items: stretch;
}

.code-body {
  flex: 1 1 auto;
  /* flex item의 기본 min-width:auto는 <pre>의 콘텐츠 기반 최소 너비(줄바꿈 없는 긴 줄의
     전체 렌더 너비)를 따라간다 — 이 값이 없으면 긴 줄이 .code-body(와 그 옆 gutter)를
     wrapper 밖으로 밀어내며, 원래 <pre>/<code> 안에서 스크롤돼야 할 게 레이아웃 자체를
     깨버린다. */
  min-width: 0;
}

.code-lang-row {
  padding: 0.32rem 0.85rem 0.18rem;
}
.code-lang {
  font-size: 11px; font-family: var(--font-mono); color: var(--code-label);
}

#content pre {
  background: transparent !important;
  border-radius: 0;
  margin: 0;
  overflow: hidden;
  min-width: 0;
}

/* 영구 고정폭 우측 여백 — #source-lines(줄번호 거터, index.html:704)와 같은 40px 폭 관례.
   24x24 버튼에 양쪽 여유 패딩까지 편하게 들어간다. 코드의 가로 스크롤 영역이 이 컬럼을
   절대 침범할 수 없어서(형제 컬럼이지 오버레이가 아니므로) 어떤 줄 길이에서도 겹침이
   구조적으로 불가능하다. */
.code-gutter {
  flex: 0 0 40px;
  display: flex; justify-content: center;
  padding-top: 6px;
  border-left: 1px solid transparent;
  transition: border-left-color .15s;
}
.code-wrapper:hover .code-gutter { border-left-color: var(--code-border); }

.copy-btn {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border-radius: 6px;
  background: var(--code-bg); border: 1px solid var(--code-copy-border);
  color: var(--code-label);
  cursor: pointer; transition: background .1s, color .1s, opacity .15s;
  opacity: 0;
}
.code-wrapper:hover .copy-btn { opacity: 1; }
.copy-btn:hover { background: color-mix(in srgb, var(--code-bg) 85%, var(--text) 15%); color: var(--code-text); }
.copy-btn.copied { color: #2da44e; border-color: #2da44e40; opacity: 1; }
[data-theme="dark"] .copy-btn.copied { color: #98c379; border-color: #98c37940; }

#content pre code {
  display: block;
  padding: 0.8em 0.9em 0.9em;
  background: none !important; border: none !important; border-radius: 0;
  color: var(--code-text);
  font-size: 0.875em; line-height: 1.7;
  overflow-x: auto;
  white-space: pre;
}
```

**변수 참고**: `--code-border`(라이트 `#d0d7de`/다크 `rgba(255,255,255,0.06)`, index.html:66,97)가 두 테마 모두에 정의돼 있는데 지금까지 아무 데도 안 쓰이고 있었다 — 딱 이런 "코드블럭 내부 구분선" 용도로 이미 준비된 변수라 재사용. `--code-copy-border`(버튼 자체 테두리 전용)와 구분해서 쓴다.

`align-items: stretch`(flex 기본값)로 `.code-gutter`가 `.code-body`(=`<pre>` 높이)에 맞춰 늘어난다 — 별도 height 규칙 불필요. gutter 자체 콘텐츠 높이(~30px)는 실제 코드블럭 높이(한 줄이어도 ~44px+)보다 항상 작으므로 `<pre>`가 항상 더 큰 쪽 — 기존 "no-language 높이는 pre와 동일" 테스트 공식이 그대로 유지된다.

지울 주석: 1105-1106번째 줄("Overlaid on top of the code...")과 1118-1120번째 줄("Solid ... so it fully occludes...") — 둘 다 이제 사실이 아님.

**`@media print` 규칙 수정** (1169번째 줄): `.copy-btn` → `.code-gutter`로 교체(구분선 포함해서 통째로 숨김, 빈 컬럼 자국 안 남게).

### 3. `src/renderer/app-runtime.js`

`COPY_ICON` 상수(약 285번째 줄)의 `rect height="9"` → `height="8"`로 동일하게 수정. 두 파일에 중복된 SVG 문자열 — 공유 안 하고 양쪽 다 직접 고친다(이 코드베이스의 `window.MDVMarkdown`/`window.MDVAppRuntime` 전역 공유 패턴이 UI 문자열 상수 공유용으로 쓰인 적이 없어서, 2글자 차이 하나 때문에 새 커플링을 만들 이유가 없음).

## 변경 파일
- `src/renderer/markdown.js`
- `src/renderer/index.html`
- `src/renderer/app-runtime.js`
- `tests/unit/markdown.test.js`
- `tests/electron/smoke.test.js`

## 테스트 계획

- `tests/unit/markdown.test.js` 62-74번째 줄: 기존 assertion 그대로 통과(문자열 서브스트링 매칭이라 구조 변경에 영향 안 받음). `class="code-lang-row"`/`class="code-body"`/`class="code-gutter"` 존재 확인을 추가해서 새 구조를 고정.
- `tests/electron/smoke.test.js`:
  - 301-351번째 줄(`openFile loads markdown...`): 326-335번째 줄의 "우측상단 절대위치" assertion(주석 포함 — 지금은 틀린 설명)을 gutter/body 겹침-없음 assertion으로 교체.
  - 353-395번째 줄(`code fence with no language...`): 369-371번째 줄 그대로 통과. `.code-gutter`/`.copy-btn`이 언어 없어도 존재하는지 확인 추가.
  - **신규 테스트**: 긴 줄(400자) 코드펜스를 만들어 `.code-body`/`.code-gutter` 겹침 없음 + `code.hljs`를 끝까지 스크롤해도 gutter 위치/폭이 그대로인지 확인 — 이 재설계가 고치는 핵심 버그의 회귀 가드. `#content`에 직접 append해야 실제 `overflow-x:auto` 스크롤이 작동한다(no-language 테스트처럼 `document.body`에 붙이면 스크롤 자체가 안 일어나 테스트가 공허하게 통과함 — 주의).

### 검증 순서
1. `npm run test:unit` / `node --test tests/electron/smoke.test.js`(전체) 통과 확인.
2. 실제로 앱을 띄워서(이 세션에서 여러 번 썼던 패턴 — `require(ROOT+'/node_modules/playwright')`/`electron`, `page.evaluate`로 `window.MDVMarkdown.createMarkdownController(...).renderMarkdown(...)` 호출 후 `#content`에 주입) 스크린샷으로 확인:
   - 언어 있음 + 긴 줄, hover 전/후 — 겹침 없음, 아이콘 안 잘림.
   - 언어 없음 + 긴 줄, hover 후 — 예약 줄 없음, 겹침 없음.
   - 라벨 줄 클로즈업 — 배경 칩 없는 플레인 텍스트인지.
3. 스크린샷 확인 후 필요하면 아래 리스크 항목의 세부 스타일을 조정.

## 리스크 / 미결정 사항

- **라벨 줄 하단 보더 없음으로 결정** — 사용자가 참고한 "이전 스타일"의 `.code-meta`가 `border-bottom: none`이었음. 그대로 따름. (원하면 `.code-lang-row`에 `border-bottom: 1px solid var(--code-border)` 추가 가능.)
- **구분선은 hover에만 보이는 것으로 결정**(항상 켜져있지 않음), 복사 버튼도 계속 hover에만 opacity 1 — 지금 앱 전반의 "평상시엔 미니멀, hover 시 드러남" 패턴과 일관되게. 여백 자체(공간)는 항상 예약돼 있어서 겹침 버그는 hover 여부와 무관하게 고쳐진다 — 이 부분만 취향 차이. 스크린샷 확인 후 마음에 안 들면 `.code-wrapper:hover .code-gutter` 조건을 제거해서 항상 보이게 한 줄로 바꿀 수 있음.
- 구현 시 반드시 실제 앱을 띄워 스크린샷으로 확인할 것 — 이번 항목은 순수 시각/레이아웃 변경이라 자동화 테스트만으로는 "보기에 괜찮은지"를 보장 못 한다.
