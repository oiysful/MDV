# 26. 프론트매터를 Gitea 방식으로 렌더하기

## 상태
**구현·검증 완료 (2026-10-02).** PR #33(Gitea 방식 렌더 — `details.frontmatter-content`, summary = 아이콘 + 키를 `, `로 이은
목록 + 시각적으로 숨긴 "메타데이터: ", 가로 표, 배열은 쉼표 한 줄, 중첩 객체는 `키: 값` 줄, 날짜·숫자·불리언 칸은 nowrap),
PR #34(보안: 렌더 예산), PR #35(인쇄/PDF)로 develop에 머지했다. 계획 25의 js-yaml 5 PR(#32) 뒤에 착수한다는 순서를 지켰다.
**계획서와 달라진 점은 맨 아래 "착수 결과" 절.** 아래는 조사 당시 본문이다.

## 요약

| | 현재 MDV | Gitea (`details` 모드, 기본값) | 이 계획 |
|---|---|---|---|
| summary | `메타데이터` | 표 아이콘 + 최상위 키를 `, `로 나열, 한 줄 말줄임 | **Gitea와 같음** + 전체 목록 `title`, 스크린리더용 "메타데이터" |
| 본문 표 | 세로 `키 \| 값` 행 (`th`가 왼쪽 열) | **가로 표** — 헤더 행 = 키, 그 아래 한 행 = 값 | **Gitea와 같음** (MDV의 마크다운 표 스타일 그대로) |
| 값 표시 | 타입별: 날짜 서식, 여러 줄 보존, 배열 → 세로 목록, 객체 → 중첩 세로 표 | YAML 원문 문자열 그대로. 배열 → 한 열짜리 표, 객체 → 중첩 가로 표 | **MDV의 타입 처리 유지**(의도적 차이). 배열 → 쉼표 한 줄, 객체 → `키: 값` 줄 |
| 넓을 때 | — | `.markup table { display: block; overflow: auto }` 가로 스크롤 | 래퍼에 `overflow-x: auto` (드문 경우용 안전장치) |
| 기본 펼침 | 접힘 | 접힘 | 접힘 유지 |

## 1. Gitea는 실제로 어떻게 하나 — 소스로 확인

**`modules/markup/markdown/convertyaml.go`**
- `nodeToDetails`: 최상위가 매핑일 때만 동작. 스칼라 키를 모아 summary를
  `htmlutil.HTMLFormat("%s %s", svg.RenderHTML("octicon-table", 12), strings.Join(keys, ", "))`로 만든다
  (`HTMLFormat`이 키를 이스케이프). `<details class="frontmatter-content">` 안에 `nodeToTable(meta)`.
- `mappingNodeToTable`: 키마다 헤더 칸 하나, 값마다 값 칸 하나 → **헤더 행 1 + 값 행 1인 가로 표**.
- `sequenceNodeToTable`: 배열은 항목마다 행 하나인 **한 열짜리 표**.
- 스칼라는 `ast.NewString(meta.Value)` — **YAML에 쓴 원문 그대로**, 타입 해석 없음.

**`modules/markup/markdown/renderconfig.go`** — 표시 모드 `details`(기본)·`table`·`none`. 프론트매터의
`gitea: table` 또는 `gitea: { meta: details, include_toc: …, lang: … }`로 문서마다 바꾼다.
**`markdown.go:209`** `rc := &RenderConfig{Meta: markup.RenderMetaAsDetails}` — 기본이 details.

**`modules/markup/markdown/markdown_test.go`의 기대 HTML** (`MapInFrontmatter`):
```html
<details class="frontmatter-content"><summary><span>octicon-table(12/)</span> key1, key2</summary><table>
<thead><tr><th>key1</th><th>key2</th></tr></thead>
<tbody><tr><td>val1</td><td>val2</td></tr></tbody>
</table></details><p>test</p>
```
최상위가 배열(`ListInFrontmatter`)이면 프론트매터로 보지 않고 `<hr/>` + 목록으로 렌더한다 — MDV도 이미 같다.

**`web_src/css/markup/content.css`**
```css
.markup details.frontmatter-content summary { text-overflow: ellipsis; overflow: hidden; white-space: nowrap; margin-bottom: 0.25em; }
.markup details.frontmatter-content svg { vertical-align: middle; margin: 0 0.25em; }
.markup table { display: block; width: 100%; max-width: 100%; overflow: auto; }
```
아이콘이 안 보이던 버그가 있었다(이슈 #34101 → PR #34102로 수정) — 아이콘은 인라인 SVG로 넣는다.

## 2. MDV에서 가로 표가 실제로 어떻게 보이나 — 실측

### 실제 프론트매터는 키가 몇 개인가
이 저장소의 커밋된 `.md`에는 프론트매터가 없어서, 이 컴퓨터의 `~/projects`·`~/.claude` 아래 `.md` 2,381개를
훑었다. 매핑 프론트매터가 있는 파일 **575개**의 최상위 키 수:

| 키 수 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 13 |
|---|---|---|---|---|---|---|---|---|
| 파일 | 77 | 95 | **215** | 95 | 64 | 21 | 7 | 1 |

**95%(546개)가 5개 이하.** 가장 흔한 키는 `name`·`description`(대부분 긴 문장)·`model`·`level`·`tools`.

### 가로 표 프로토타입 (실제 앱, 본문 폭 888px, MDV `#content table` 스타일)
| 표본 | 표 폭 | 가로 스크롤 | 값 행 높이 |
|---|---|---|---|
| 키 3개 (memory 형태: name, 긴 description, 중첩 metadata) | 888 | 없음 | 66px |
| 키 5개 (agent 형태: name, 긴 영어 description, model, level, tools[4]) | 888 | 없음 | 66px |
| 키 8개 (blog 형태: title, date, author, tags[4], draft, category, 여러 줄 description, 중첩 seo) | 888 | 없음 | 90px |

규칙은 **타입 기반**이다: 날짜·숫자·불리언만 줄바꿈 금지, 문자열은 자연스럽게 줄바꿈, 최소 폭 없음.

> 정정 기록: 첫 프로토타입은 "24자 이하 문자열 줄바꿈 금지 + 긴 문자열 최소 폭"을 넣었다가 키 8개에서 1000px,
> 14개에서 1560px로 넘쳤다. 그건 가로 표의 성질이 아니라 그 규칙 때문이었다. 또 MDV 표 스타일을 그대로 쓴
> 첫 시도에선 날짜가 `2026-` / `09-30`으로 꺾였다 — 날짜 줄바꿈 금지가 그 해결이다.

남는 흠: `code-reviewer`처럼 하이픈이 있는 짧은 값이 좁은 칸에서 하이픈에서 꺾인다(키 5개 표본). 감수할 만하다.

## 3. 설계 — 고정 사항

- **summary**: 인라인 SVG 표 아이콘(12px, `aria-hidden`) + 최상위 키를 `, `로 이은 텍스트.
  - **키는 반드시 `escapeHtml`** — 신뢰할 수 없는 YAML에서 온다(Gitea도 `HTMLFormat`으로 이스케이프). 전체 HTML은
    지금처럼 DOMPurify를 거친다.
  - 한 줄 + 말줄임(`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`), 잘릴 때를 위해
    **`title`에 전체 키 목록**.
  - **접근성**: 키만 있으면 스크린리더가 무엇인지 알 수 없다 → 시각적으로 숨긴 "메타데이터: " 접두어(`.visually-hidden`)를
    summary 앞에 둔다.
- **본문**: `<thead>`에 키, `<tbody>` 한 행에 값. 스타일은 별도 `.frontmatter-table` 대신 **본문 마크다운 표와 같은 규칙**을
  쓴다(대문자 회색 헤더, 테두리). 바깥 카드(배경·테두리 박스)는 없애고 Gitea처럼 표 자체가 보이게 한다.
- **넓을 때**: 표를 `<div class="frontmatter-scroll">`(`overflow-x: auto`)로 감싼다. 5% 미만의 경우용.
- **인쇄/PDF**: `overflow-x: auto` 래퍼는 인쇄 시 잘린다 → `@media print`에서 `overflow: visible`, 표 `table-layout: auto`.
  펼친 상태로 인쇄해 확인한다.
- **값 표시는 MDV의 타입 처리를 유지한다 — Gitea와의 의도적 차이.** 날짜는 `formatFrontmatterDate`, 여러 줄은 줄 보존,
  날짜·숫자·불리언은 `white-space: nowrap`.
  - **배열**: Gitea는 한 열짜리 표, 현재 MDV는 세로 목록. 가로 표의 한 칸 안에서는 행 높이를 키우므로 **쉼표로 이은 한 줄**로
    바꾼다(프로토타입에서 tags[4] → 2줄). 객체를 담은 배열은 항목마다 아래 객체 규칙.
  - **중첩 객체**: Gitea는 칸 안에 가로 표를 또 넣는다. 칸 안 표는 헤더 배경까지 겹쳐 어수선했다(첫 시도 스크린샷) →
    **`키: 값` 줄**(키는 회색)로 압축.
- **TOC·단어 수**: 지금처럼 프론트매터는 둘 다에서 제외(변경 없음).

## 4. 범위 밖 (요청하지 않음)
- Gitea의 `gitea:` 제어 키, `table`(접지 않고 표만)·`none` 모드. 필요해지면 `extractFrontmatter`가 그 키를 읽어
  모드를 고르는 형태로 추가할 수 있다.
- Gitea처럼 값을 원문 문자열로 보여 주기 — MDV의 타입 처리가 더 낫다.

## 5. 테스트

`tests/unit/markdown.test.js`의 프론트매터 테스트(584–657행 부근)에서 바뀌는 것:
- `details.frontmatter-card` 선택자 → 새 클래스명. "접힘이 기본" 단언은 유지.
- `ul.frontmatter-list`(배열 → 목록) → 쉼표 한 줄 단언으로 교체.
- `div.frontmatter-multiline` → 여러 줄 보존 단언은 유지(클래스명 따라 갱신).
- `<script>` 이스케이프 단언 유지.

새로 추가:
- summary 텍스트가 정확히 `키1, 키2, …`(키 순서 = YAML 순서).
- **키가 summary에서 이스케이프**된다(`"<img onerror>": x` 같은 키).
- summary의 `title`에 전체 목록, 숨긴 "메타데이터" 접두어 존재.
- `thead`의 `th` 순서 = 키 순서, 값 행 칸 수 = 키 수.
- 날짜 칸에 `nowrap`, 배열이 쉼표로 이어짐, 중첩 객체가 `키: 값` 줄.
- 인쇄 규칙: Electron에서 `emulateMedia({ media: 'print' })`로 래퍼의 `overflow`가 `visible`인지(업데이트 배너 인쇄 테스트와 같은 방식).

## 순서 — 계획 25와의 관계
계획 25의 **js-yaml 5 PR**이 `extractFrontmatter`와 같은 테스트를 고친다(스키마로 날짜를 `Date`로 되살리기, 빈 프론트매터
처리). 날짜 칸의 서식도 그 스키마 수정에 기대므로 **26은 25의 js-yaml PR 뒤**에 착수한다. 전체 순서는
Electron 44(기한 10/20) → 저위험 묶음 → KaTeX → js-yaml 5 → **이 계획**.

## 출처
- Gitea 소스: `modules/markup/markdown/convertyaml.go`(`nodeToDetails`, `mappingNodeToTable`, `sequenceNodeToTable`),
  `renderconfig.go`(`RenderConfig`, 모드 파싱), `markdown.go:209`(기본 details), `markdown_test.go`(`MapInFrontmatter` 기대 HTML),
  `web_src/css/markup/content.css` — https://github.com/go-gitea/gitea
- Gitea 이슈 #34101 "Frontmatter summary icon is not displayed", PR #34102 "Fix markdown frontmatter rendering":
  https://github.com/go-gitea/gitea/issues/34101 , https://github.com/go-gitea/gitea/pull/34102
- Go 패키지 문서 `RenderConfig`: https://pkg.go.dev/code.gitea.io/gitea/modules/markup/markdown
- Context7 `/websites/deepwiki_go-gitea_gitea` — 프론트매터가 TOC·언어 등 렌더 옵션을 설정한다는 개요만 있고 표시 모드 설명은
  없었다. 그래서 위 소스·테스트를 기준 자료로 삼았다.
- MDV 현재 구현: `src/renderer/markdown.js` `renderFrontmatterCard`/`renderFrontmatterValue`, `index.html`의 `.frontmatter-*` 규칙,
  계획 14(`../2026-08-14/14-frontmatter-yaml-structures.md`)

## 착수 결과 (2026-10-02) — 계획과 달라진 점

- **인쇄/PDF는 계획의 "`overflow: visible` + 펼쳐 인쇄"가 아니라 세로 배치로 바뀌었다 (PR #35).** 프론트매터는 화면에서 접혀
  있어도 **항상 펼쳐서** 인쇄한다(`::details-content { content-visibility: visible }`). summary는 숨기고, 표는 세로 `키 | 값`
  격자로 다시 흘린다(`--fm-keys` 인라인 스타일 + `grid-auto-flow: column`) — 키가 많은 가로 표가 종이 폭에서 잘리지 않게 하려는 것.
  Ian이 빌드한 앱에서 직접 확인했다.
- **정수 키 순서 예외**: summary·표의 키 순서는 YAML 순서라고 계획했지만, JS 객체는 정수형 키(`1:`, `2:`)를 삽입 순서와
  무관하게 앞으로 올린다. 이 경우만 YAML 순서와 어긋나는 것을 알려진 예외로 둔다.
- **렌더 예산 (PR #34, 보안)**: 신뢰할 수 없는 YAML이 렌더러를 부풀릴 수 있어 상한을 뒀다 — 값 5000개 / 100k자(이스케이프 전
  기준, 최악 ~6배 ≈ 600KB HTML), null을 포함한 모든 방문이 노드 1개로 계산, 깊이 100(= 로더 `maxDepth`), `onPath` WeakSet으로
  순환 절단, `render()`의 try/catch 최후 방어. 보안 리뷰 2회, `memory-security.md`에 기록됨. 계획 25 §2가 "기본값 유지"로 기대했던
  alias 방어는 로더가 아니라 이 예산이 맡는다(`maxAliases` 기본은 무제한).
