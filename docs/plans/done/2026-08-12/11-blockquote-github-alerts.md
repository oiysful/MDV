# 11. 블록쿼트 GitHub 스타일 Alert(`[!NOTE]` 등) 렌더링 추가

## 상태
**구현·검증 완료** (2026-08-12). `renderer.blockquote` 오버라이드 + CSS + 유닛 테스트 6건 추가. 유닛 123개(신규 6건 포함)·컨트롤러 12개·Electron 스모크 81개(1개는 `default-app-guide` 기존 flaky, 단독 재실행 시 통과 확인 — 이번 변경과 무관) 전부 통과. 실제 앱을 띄워 라이트/다크 테마 양쪽에서 5종 alert 렌더링을 스크린샷으로 확인, 사용자가 공유한 GitHub 참고 이미지와 시각적으로 일치.

## 문제
GitHub Flavored Markdown은 블록쿼트 첫 줄에 `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` 마커를 쓰면 아이콘 + 색상이 있는 알림 박스로 렌더한다([GitHub 문서](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts) 참고, Ian이 스크린샷 공유). MDV는 현재 이 마커를 인식하지 못하고 일반 블록쿼트로만 렌더한다.

## 근거 / 원인 (확정)

`src/renderer/markdown.js`는 `marked` v9 + 커스텀 `Renderer`로 mermaid/KaTeX 코드펜스 같은 특수 블록을 이미 `renderer.code` 훅으로 처리 중이다(markdown.js:191-235). 블록쿼트는 아직 기본 렌더러 그대로다.

marked v9의 `renderer.blockquote(quote)`는 **토큰 객체가 아니라 이미 렌더링된 내부 HTML 문자열**을 받는다(`node_modules/marked/lib/marked.cjs:1651`, `1867-1870`에서 확인). 실제 출력 형식을 노드로 직접 검증함(`breaks:true, gfm:true` — markdown.js:236과 동일 옵션):

```js
marked.parse('> [!NOTE]\n> Useful info.\n')
// → '<blockquote>\n<p>[!NOTE]<br>Useful info.</p>\n</blockquote>\n'

marked.parse('> [!WARNING]\n>\n> line1\n> line2\n')
// → '<blockquote>\n<p>[!WARNING]</p>\n<p>line1<br>line2</p>\n</blockquote>\n'
```

즉 두 가지 형태를 모두 처리해야 한다:
1. 마커 다음 줄에 빈 줄이 없으면 `<p>[!TYPE]<br>본문...</p>` — 같은 문단 안에서 `<br>`로 이어짐.
2. 마커와 본문 사이에 빈 줄이 있으면 `<p>[!TYPE]</p>` 단독 문단 다음에 본문 문단(들)이 이어짐.

DOMPurify는 별도 `ALLOWED_TAGS` 설정 없이 기본값으로 호출 중이며(markdown.js:148-166), 이미 mermaid/KaTeX의 `<svg>`/`<path>`/`data-*` 속성을 그대로 통과시키고 있으므로 알럿 마크업에 `<div>`, `class`, 인라인 `<svg>` 아이콘을 써도 추가 설정이 필요 없다.

## 제안 방안

라벨 텍스트는 영어 원문(Note/Tip/Important/Warning/Caution) 그대로 사용 — GitHub 원문 스크린샷과 동일, 다른 마크다운 뷰어/에디터에서도 통용되는 표준 용어라 번역하지 않기로 확정(Ian 확인 완료).

### 1. `src/renderer/markdown.js` — `renderer.blockquote` 오버라이드

`renderer.code = ...` 정의 다음, `markedLib.setOptions(...)` 호출 이전(markdown.js:236 부근)에 추가:

```js
const ALERT_TYPES = {
  NOTE:      { label: 'Note',      icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="..."/></svg>' },
  TIP:       { label: 'Tip',       icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="..."/></svg>' },
  IMPORTANT: { label: 'Important', icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="..."/></svg>' },
  WARNING:   { label: 'Warning',   icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="..."/></svg>' },
  CAUTION:   { label: 'Caution',   icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="..."/></svg>' },
}

renderer.blockquote = (quote) => {
  const match = /^\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:<br\s*\/?>\s*|\s*<\/p>\s*)/i.exec(quote)
  if (match) {
    const type = match[1].toUpperCase()
    const config = ALERT_TYPES[type]
    const consumedWholeParagraph = /<\/p>\s*$/.test(match[0])
    const rest = quote.slice(match[0].length)
    const body = consumedWholeParagraph ? rest : `<p>${rest}`
    return `<div class="markdown-alert markdown-alert-${type.toLowerCase()}"><p class="markdown-alert-title">${config.icon}${config.label}</p>${body}</div>\n`
  }
  return `<blockquote>\n${quote}</blockquote>\n`
}
```

- `i` 플래그로 대소문자 무관 매칭(`[!note]`도 인식), 실제 타입 키는 항상 대문자로 정규화.
- 마커 뒤에 같은 줄에 다른 텍스트가 붙는 경우(`[!NOTE] 텍스트`)는 정규식이 `\[!TYPE\]` 바로 뒤에 `<br>` 또는 `</p>`만 허용하므로 매치되지 않고 자동으로 일반 블록쿼트 폴백 — GitHub 규칙과 동일.
- 아이콘 SVG는 기존 `copy-btn` 아이콘(markdown.js:233)과 동일한 스타일(`viewBox`, `fill="currentColor"`, `aria-hidden="true"`)로 5종 작성. GitHub Primer octicon 기준 정보/전구/말풍선-느낌표/삼각경고/정지팔각형 아이콘을 사용.

### 2. `src/renderer/index.html` — CSS 추가

`#content blockquote p { margin: 0; }` (index.html:1077) 바로 뒤에 추가. 색상은 GitHub 알럿 색상 체계를 참고해 5종 고정 accent 컬러를 라이트/다크 각각 지정하고(기존 `.copy-btn.copied`가 `[data-theme="dark"]`로 색을 오버라이드하는 패턴과 동일, index.html:1131-1132), 배경은 `color-mix(in srgb, var(--alert-color) 8%, transparent)`로 은은하게 tint(`--brand-light` 만드는 방식과 동일 기법).

```css
.markdown-alert {
  margin: 1.2em 0; padding: var(--sp-sm) var(--sp-md);
  border-left: 3px solid var(--alert-color);
  background: color-mix(in srgb, var(--alert-color) 8%, transparent);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}
.markdown-alert p:last-child { margin-bottom: 0; }
.markdown-alert-title {
  display: flex; align-items: center; gap: 6px;
  font-weight: 600; color: var(--alert-color);
  margin-bottom: .4em;
}
.markdown-alert-note      { --alert-color: #0969da; }
.markdown-alert-tip       { --alert-color: #1a7f37; }
.markdown-alert-important { --alert-color: #8250df; }
.markdown-alert-warning   { --alert-color: #9a6700; }
.markdown-alert-caution   { --alert-color: #cf222e; }
[data-theme="dark"] .markdown-alert-note      { --alert-color: #58a6ff; }
[data-theme="dark"] .markdown-alert-tip       { --alert-color: #3fb950; }
[data-theme="dark"] .markdown-alert-important { --alert-color: #a371f7; }
[data-theme="dark"] .markdown-alert-warning   { --alert-color: #d29922; }
[data-theme="dark"] .markdown-alert-caution   { --alert-color: #f85149; }
```

본문 텍스트는 `#content` 기본 `color: var(--text)`를 그대로 상속한다 — 일반 블록쿼트(`--text-muted`, index.html:1075)와 달리 GitHub 알럿은 제목만 강조색이고 본문은 일반 텍스트 톤(스크린샷 기준).

## 변경 파일
- `src/renderer/markdown.js`
- `src/renderer/index.html`
- `tests/unit/markdown.test.js`

## 테스트 계획

`tests/unit/markdown.test.js`의 mermaid/latex 테스트 패턴(`renderMarkdown` 직접 호출 후 정규식으로 결과 검증, 149-247번째 줄 부근)을 따라 추가:

- 5종 타입(`NOTE/TIP/IMPORTANT/WARNING/CAUTION`) 각각 `markdown-alert-<type>` 클래스와 라벨 텍스트(`Note`/`Tip`/`Important`/`Warning`/`Caution`)가 렌더되는지.
- 소문자 마커(`[!note]`)도 인식되는지(대소문자 무관).
- 빈 줄로 분리된 멀티 문단 알럿 본문(`[!WARNING]\n\nbody1\nbody2`)이 올바르게 렌더되는지.
- 일반 블록쿼트(`> 그냥 인용문`)는 기존처럼 `<blockquote>`로 렌더되고 `.markdown-alert` 클래스가 없는지(회귀 방지).
- `[!NOTE] 텍스트`처럼 마커 뒤에 같은 줄로 텍스트가 붙은 경우 알럿으로 인식되지 않고 일반 블록쿼트로 폴백하는지.
- 알럿 본문에 `<script>` 등이 섞여도 기존 XSS 테스트와 동일하게 DOMPurify sanitize가 적용되는지.

### 검증 순서
1. `node --test tests/unit/markdown.test.js` (또는 `npm run test:unit`)로 신규/기존 테스트 통과 확인.
2. `run` 스킬로 앱을 실제로 띄워서 5종 마커를 담은 테스트 마크다운을 열고, 라이트/다크 테마 양쪽에서 스크린샷으로 실제 렌더링을 사용자가 공유한 참고 이미지와 비교 확인.
3. 기존 일반 블록쿼트/mermaid/KaTeX 렌더링에 회귀가 없는지 Electron 스모크 테스트까지 포함해 전체 스위트 1회 실행.

## 리스크 / 미결정 사항

- 아이콘 SVG path는 GitHub Primer octicon(info/light-bulb/report/alert/stop)을 참고해 작성하되, 구현 시 실제 브라우저에서 잘림/여백 확인 필요(09번 계획에서 겪은 `viewBox` 클리핑 버그 전례 있음).
- 알럿 마커 정규식이 `<p>` 시작 태그를 전제로 하므로, 블록쿼트 안에 알럿 마커가 리스트/코드펜스 등 다른 블록 요소로 시작하는 비정상적인 입력(`> [!NOTE]`가 아니라 `> - [!NOTE]` 같은 형태)은 알럿으로 인식되지 않고 일반 블록쿼트로 폴백한다 — GitHub 동작과 동일하다고 가정하지만 구현 후 실제 GitHub 렌더링과 교차 확인은 하지 않음(범위 밖).
