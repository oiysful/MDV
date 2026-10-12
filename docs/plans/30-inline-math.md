# 30. 인라인 수식(`$…$`) 지원

## 상태
**보류(2026-10-12, Ian 결정).** 조사는 끝났고 앱 코드는 바꾸지 않았다. README·README.ko의 알려진 제한사항에 "수식은 `math`/`latex` 펜스에서만 렌더링된다"고 적었다.
- **보류 근거**: 코퍼스에서 실수요가 거의 없다(인라인 수식이 든 문서는 플러그인 문서 1개, `$$` 블록 0개). 블록 수식은 이미 펜스로 된다. 지원하지 않을 때의 실패 모습은 "원문이 그대로 보임"이라 무해하다. 반대로 구현은 marked 내부(`Lexer.prototype.inlineTokens`)에 기대고 이후 marked 커스터마이즈에 불변식 하나를 남기며, §5의 새 오렌더 경우를 들인다.
- **재개 조건**: (1) 인라인 수식이 든 문서를 실제로 MDV로 보게 될 때(Ian 또는 사용자 요청). (2) 그때 marked 업그레이드([계획 24](./24-marked-upgrade.md))가 정리된 뒤 최종 버전에 한 번만 구현한다. 재개하면 §6의 결정부터 시작한다.

아래는 조사 당시 기록이다. 아래 수치는 모두 scratchpad
프로토타입(marked 9.1.6 · KaTeX 0.18.9, MDV의 `node_modules` 그대로)과 실제 문서 코퍼스에서 실측한 것이고,
재현에 필요한 규칙·코드는 맨 아래 "재현 방법"에 옮겨 두었다.

## 배경
README 스크린샷(커밋 `0e60fde`)을 만들다가 데모 문서의 `$e^{i\pi}+1=0$`이 원문 그대로 찍혔다. MDV의 수식은
2026-08-10에 넣은 ` ```math `/` ```latex ` 펜스 블록뿐이다(`markdown.js`의 `renderer.code` 분기). GitHub·Obsidian·
Typora·Jupyter에서 쓰는 `$…$`·`$$…$$`는 그냥 글자로 나온다.

## 요약
- **문법은 GitHub 호환 세 가지**: 인라인 `$…$`, GitHub의 `` $`…`$ ``, 줄 단위 디스플레이 `$$…$$`. 통화·셸 변수와
  헷갈리지 않도록 pandoc식 경계 규칙에 "닫는 `$` 뒤에 ASCII 영숫자가 오면 수식이 아니다"를 더했다(§1).
- **오인식은 실측상 거의 없다**: `~/projects`·`~/.claude`의 `.md` 2,495개에서 이 규칙이 잡은 것은 6건, 모두 진짜
  수식이었다. 이 규칙을 빼면 셸 변수(`$HOME/.bin:$PATH`)와 템플릿 변수가 잡힌다(§2).
- **구현의 핵심 제약은 성능이다.** `inlineText`에 정규식을 다는 순진한 구현은 `'$a '×20000`에서 **1ms → 9.4초**였다.
  계획 23에서 겪은 `start()` O(n²)와 같은 종류다. 인라인 소스마다 한 번만 훑어 위치를 미리 계산하는 구조로 바꾸면
  모든 악성 입력이 기준선 수준이었다(§3). marked 18.1.0에서도 같은 결과라 계획 24의 업그레이드와도 충돌하지 않는다.
- **앱에 붙일 때 결정할 곳이 셋 있다**: 헤딩 안 수식의 목차 라벨·앵커, 검색이 KaTeX 내부 텍스트를 훑는 문제,
  KaTeX 지연 로딩 조건(§4).

## 1. 문법 — 무엇을 수식으로 볼 것인가

GitHub 문서([Writing mathematical expressions](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions))가
정한 형태를 따르되, 경계 규칙은 더 보수적으로 잡는다. GitHub는 통화 `$`를 `<span>$</span>`로 감싸라고 안내할 만큼
느슨하게 짝을 짓는다. MDV는 이미 있는 문서를 여는 뷰어라서, 사용자가 문서를 고치지 않아도 오인식이 없어야 한다.

| 형태 | 규칙 | 비고 |
|---|---|---|
| `$…$` (인라인) | 여는 `$` 뒤 공백·`$` 금지, 닫는 `$` 앞 공백 금지, 내용에 줄바꿈·이스케이프 안 된 `$` 금지, **닫는 `$` 뒤 ASCII 영숫자 금지, 여는 `$` 앞 ASCII 영숫자 금지** | 굵게 표시한 두 조건이 pandoc 규칙에 더한 것 |
| `` $`…`$ `` (인라인) | GitHub의 백틱 형태. 내용이 `*`·`_`처럼 마크다운과 부딪힐 때 쓰는 탈출구 | 강조 안에서도 안전(§5) |
| `$$…$$` (디스플레이) | 여는 `$$`가 줄의 시작이고 닫는 `$$` 뒤가 줄 끝이어야 함. 여러 줄 가능 | 문장 속 `$$`(비용 등급 표기 등)는 글자로 남음 |
| `\$` | 언제나 글자 `$` | marked의 escape 토크나이저가 처리 |

"ASCII 영숫자"로 한정한 이유: `\p{L}`(모든 문자)로 잡으면 `$x$가 0일 때`처럼 **한국어 조사가 붙은 수식이 전부
빠진다**. 대가로 영어의 `the $n$th term`은 수식이 되지 않는다(`$n$-th`나 `$n\text{th}$`로 쓰면 된다).

프로토타입에서 확인한 판정:

| 입력 | 결과 |
|---|---|
| `$x$가 0일 때` | `x`만 수식 |
| `가격은 $5이고 $10이다` · `$5 and $10` | 글자 그대로 |
| `$HOME/.bin:$PATH` · `echo $A$B` | 글자 그대로 |
| `split $100 in half: $100/2$` (GitHub 예시) | `100/2`만 수식. 내용에 `$`가 못 들어가므로 앞의 `$100`과 짝이 지어지지 않는다 |
| `` GitHub: $`\sqrt{x*y}`$ `` | `\sqrt{x*y}` 수식 |
| `$\{a\}$` · `$a \\ b$` · `$a\,b$` · `$a\$b$` | 백슬래시가 그대로 KaTeX에 도달 |
| `cost: $$ to $$$` | 글자 그대로(줄 시작이 아님) |
| `**Cauchy**⏎$$⏎\sum a_k⏎$$⏎after` | 굵은 제목, 디스플레이 수식, 그 뒤 문장 순서로 렌더 |
| `**bold $a_1$**` · 표 셀 안 `$x$` · 링크 텍스트 안 `$x$` | 모두 수식 |
| `` `$code$` `` | 코드 스팬이 이김(글자 그대로) |

백슬래시가 그대로 KaTeX에 도달하는 것은 토크나이저 단계에서 수식을 떼어 내기 때문이다. `walkTokens` 같은 후처리로는
marked의 escape 토크나이저가 이미 `\{`·`\\`·`\,`를 먹은 뒤라 같은 결과를 낼 수 없다. 토크나이저 단계 설계를 택한
근거가 이것이다.

## 2. 오인식 — 실제 문서 코퍼스 실측

계획 26과 같은 코퍼스(`~/projects`·`~/.claude` 아래 `.md`)를 썼다. `node_modules`·`.git`·`dist`·`.venv`·`.build`·
`site-packages`는 뺐다. 코드 영역은 정규식이 아니라 **MDV가 쓰는 marked 9.1.6의 렉서로** 걸러 냈다. 문단·헤딩·표 셀·
목록 항목의 인라인 소스만 남기고 코드 스팬은 지웠다.

| 규칙 | 걸린 파일 | 걸린 건수 | 내용 |
|---|---|---|---|
| R1 pandoc(줄바꿈 허용) | 5 | 15 | 셸 변수·템플릿 변수 오인식 포함 |
| R2 R1 + 한 줄 제한 | 4 | 12 | `$HOME/.maestro/bin:$PATH`, `$module of legacy/$…` 등 오인식 포함 |
| R3 R2 + 앞뒤 `\p{L}\p{N}` 금지 | 1 | 6 | 오인식 0. 단 한국어 조사가 붙은 수식이 빠짐 |
| **R4 R2 + 앞뒤 ASCII 영숫자 금지 (채택안)** | **1** | **6** | **6건 모두 진짜 수식(math-olympiad 플러그인 문서)** |
| 디스플레이 `$$…$$`(줄 단위) | 0 | 0 | 비용 등급 표의 `$$`는 셀 단위라 잡히지 않음 |

참고로 1차 근사 스캔(정규식으로 코드 제거)에서는 2,611개 중 **164개 파일**이 코드 밖에 `$`를 갖고 있었다. KaTeX 지연
로딩 조건을 느슨하게 잡으면 이 파일들도 KaTeX를 받는다. 그 비용이 작다는 것과, 그래도 느슨한 조건을 권장하는 이유는
§4에 있다.

**편향**: 이 코퍼스는 Ian의 개발 문서와 Claude 플러그인·스킬 문서가 대부분이다. 수식이 많은 문서(논문 노트, 강의
자료)는 거의 없어서 **재현율(진짜 수식을 놓치는 비율)은 이 실측으로 검증되지 않았다.** `.venv` 안의 OpenTelemetry
`ieee_754.md`(`$f$`, `$sign$`, `$mantissa$`)는 R4에서도 수식으로 잡혔다.

## 3. 구현 구조 — O(n²)를 피하는 방법

### 순진한 구현(v1)은 이차 시간이다 — 실측
기존 물결표 오버라이드처럼 `tokenizer.inlineText`에서 (a) `src`가 `$`로 시작하면 정규식으로 수식을 잡고 (b) 아니면
기본 `inlineText`가 만든 텍스트 토큰을 다음 `$` 앞에서 자르는 방식이다. 결과는 맞지만 다음과 같았다.

| 입력 | 기본 marked | v1 | v2(채택안) |
|---|---|---|---|
| 산문 200KB, `$` 없음 | 4ms | 5ms | 4ms |
| `'a * '×80000` (계획 23 입력) | 43ms | — | 40ms |
| `'$a '×20000` | 1ms | **9,450ms** | 3ms |
| `'a $'×20000` | 1ms | **9,474ms** | 3ms |
| `'$'×40000` | 1ms | **10,861ms** | 1ms |
| `'$$a '×20000` | 2ms | **6,073ms** | 3ms |
| `` '$`a '×20000 `` | 46ms | 908ms | 43ms |
| `'$x$ aaaa '×5000` (수식 5000개) | 3ms | — | 44ms |
| `'$x_i^2$ '×5000` (수식 5000개) | 3ms | 4ms* | 108ms |

\* v1의 이 값은 수식을 하나만 렌더한 버그 결과다(아래 "토큰 병합 함정").
수식 5000개의 44~108ms는 KaTeX `renderToString` 자체 비용이다(개당 약 10~20µs). 선형이다.

v1이 이차인 이유는 기본 텍스트 정규식이 특수 문자(`*`·`_`·`` ` ``·`~` 등)가 없는 구간을 문단 끝까지 한 번에 먹기
때문이다. 그걸 다음 `$`에서 자르면, 다음 호출이 같은 구간을 처음부터 다시 훑는다. 앞으로 다음 `$`를 찾아
`src`를 미리 자르는 방법도 안 된다. `$`가 없는 문서에서 텍스트 토큰마다 문단 끝까지 검색하게 되어, 계획 23의
`start()`와 똑같이 이차가 된다(메모리 `marked-extension-start-quadratic`).

### v2 — 인라인 소스당 한 번 훑고, 위치로 판정한다
1. **`Lexer.prototype.inlineTokens`를 감싼다.** 이 함수는 인라인 소스(문단·헤딩·표 셀·강조 안쪽 텍스트)마다 한 번
   불린다. 소스에 `$`가 있을 때만 선형 스캐너로 수식 구간 `[start, end, tex, display]` 목록을 만들어 렉서
   인스턴스에 둔다. 강조·링크 안쪽은 재귀 호출되므로 저장·복원 스택으로 다룬다.
2. **수식 인식은 `start()` 없는 인라인 확장 tokenizer가 한다.** marked는 확장 tokenizer를 매 위치마다 가장 먼저
   부른다. `src[0] !== '$'`이면 즉시 빠지고, 맞으면 미리 계산한 목록에서 O(1)로 판정한다.
3. **`inlineText` 오버라이드는 자르기만 한다.** 다음 수식 구간 앞에서 `src`를 잘라 기본 `inlineText`에 넘긴다.
   기본 정규식이 그 너머를 훑지 않으므로 이차 비용이 생기지 않는다.

스캐너의 선형성: 모든 후보의 내용이 "다음 이스케이프 안 된 `$`"에서 멈추고, 거절된 닫는 `$`가 다음 후보의 여는
`$`가 된다. 그래서 각 문자를 상수 번만 본다.

### 프로토타입이 잡아 낸 함정 두 가지
- **토큰 병합**: `inlineText`가 돌려준 토큰은 종류와 상관없이 직전 텍스트 토큰에 이어 붙는다(marked 9.1.6
  `inlineTokens` 루프의 `lastToken.type === 'text'` 분기). v1에서 문단의 두 번째 수식부터 글자로 합쳐진 원인이다.
  수식 토큰은 반드시 `inlineText`가 아닌 곳(확장 tokenizer)에서 내야 한다.
- **`$$` 오인식**: 처음 프로토타입은 `cost: $$ to $$$`를 디스플레이 수식으로 잡았다. "줄의 시작과 끝" 조건을 더해서
  해결했다(§1).

### 지켜야 할 불변식과 기존 코드와의 결합
- 위치 계산 `pos = 인라인소스.length - src.length`는 **`start()`를 가진 인라인 확장이 하나도 없을 때만** 성립한다.
  `start()`가 있으면 marked가 `inlineText`에 잘린 `cutSrc`를 넘긴다. MDV에는 지금 그런 확장이 없다. 이 사실을
  코드 주석에 남겨야 한다.
- `Lexer.prototype` 패치는 공개 API가 아니고 marked 전역에 걸린다. 지금 `intrawordTildeConfigured`가 하듯이
  인스턴스당 한 번만 적용되도록 가드해야 한다. 테스트는 같은 `marked`로 컨트롤러를 여러 번 만든다.
- 기존 물결표용 `inlineText` 오버라이드와는 **같은 함수 안에서 합친다**. `use()`로 두 번 거는 방법은 쓰지 않는다.
  두 번째 오버라이드가 첫 번째의 결과를 자를 방법이 없기 때문이다. 순서는 "수식 앞에서 자른 `src`로 기본
  `inlineText` 호출 → 물결표 보정"이다.
- **marked 18.1.0에서도 같은 프로토타입이 같은 결과**(판정 표 전부, 수식 5000개 렌더, 악성 입력 선형)였다.
  계획 24 재개 시 다시 확인할 항목으로 남긴다.

## 4. 앱에 붙일 때 건드리는 곳

| 곳 | 내용 | 결정 필요 |
|---|---|---|
| `markdown.js` 렌더러 | 확장 renderer에서 `katex.renderToString(tex, { throwOnError: false, displayMode, strict: false })`. KaTeX가 없으면(로드 실패·jsdom) 원문을 이스케이프해 글자로 낸다. 지금 펜스의 폴백과 같은 원칙이다 | — |
| 지연 로딩 조건 | 지금은 `LATEX_FENCE_RE`(펜스 존재)일 때만 KaTeX를 받는다. **느슨한 조건(예: `/\$\$\|\$[^\s$]/`)을 더하는 것을 권장한다.** `markdown.js` 42–45행 주석이 정한 원칙("오탐은 불필요한 지연 로드 한 번이라 무해하고, 미탐은 수식이 조용히 안 나오는 실패라 피한다")을 그대로 따른다. 오탐 비용도 작다. `loadScriptOnce`가 창마다 한 번만 받아 캐시하고, KaTeX CSS는 이미 항상 로드되어 있다. **스캐너를 문서 전체에 돌려 게이트로 쓰는 안은 기각**: 목록·인용문 안의 `$$` 블록은 문서 전체에서 보면 앞에 `- `·`> `·들여쓰기가 붙어 "줄 시작" 조건에서 떨어진다. 반면 파싱은 인라인 소스 단위라 그 안에서는 수식 토큰이 만들어진다. 결과적으로 KaTeX 없이 원문이 나오는 미탐이 된다 | — |
| 헤딩 속 수식 → 목차·앵커 | jsdom 실측: `## Energy $E=mc^2$`의 `textContent`가 `"Energy E=mc2E=mc^2E=mc2"`이다. MathML 글자, `annotation` 태그는 DOMPurify가 지우지만 남는 TeX 원문, HTML 글리프가 겹친다. 이 값이 목차 라벨(`buildToc`의 `heading.textContent`)과 `slugifyHeading`의 앵커에 들어간다. 소스 모드 목차(`extractHeadingsFromSource`의 `parseInline` 후 태그 제거)도 같은 문자열을 만든다 | **예** — `.katex`를 TeX 원문으로 바꿔 읽기(앵커 `energy-emc2`) vs `.katex-html`만 읽기 |
| 검색(⌘F) | `search.js`의 TreeWalker가 `#content`의 모든 텍스트 노드를 훑는다. 숨은 `.katex-mathml`까지 포함된다. 펜스 수식에도 이미 있는 문제지만, 인라인은 문장 속에 섞이므로 `x` 같은 짧은 검색어가 보이지 않는 노드에 하이라이트를 만든다 | **예** — `closest('mark,script,style')`에 `.katex` 추가(수식 안은 검색 안 됨) vs 현행 유지 |
| CSS | 인라인 `.katex`는 KaTeX 기본 스타일로 충분하다. 문단 안 디스플레이 수식은 `.katex-display`에 `.mdv-latex`와 같은 `overflow-x: auto`가 필요하다 | — |
| 보안 | KaTeX 기본값 `trust: false`가 `\href`·`\includegraphics`·`\htmlClass`를 막고, 매크로 전개는 수식당 `maxExpand` 1000이다. 출력은 지금처럼 DOMPurify를 거친다. 단 `maxSize` 기본값이 무한대라 `\rule{1e5em}{1e5em}`이 거대한 상자를 만든다. 펜스에도 있는 문제지만 인라인으로 표면이 넓어지므로 `maxSize`를 함께 정한다. 착수 시 `/security-scan` 대상 | 값만 |
| 분할뷰 입력 중 | 다시 렌더할 때마다 수식을 전부 다시 렌더한다. 실측 비용이 개당 10~20µs라 수천 개 전까지는 문제없다. 캐시는 필요해질 때 넣는다 | — |
| 테스트 | 단위: §1 판정 표 전체, §3 악성 입력의 시간 상한(계획 23 방식). Electron: 렌더 1건과 헤딩 속 수식의 목차 1건 | — |
| 문서 | README 기능 목록과 데모 스크린샷(인라인 수식이 보이도록 다시 찍기), `.ko.md` 동기화 | — |

## 5. 알려진 한계
- **강조가 수식을 가로지르면 강조가 이긴다**: `*a $x*y$ b*` → `<em>a $x</em>y$ b*`. marked의 강조 짝 찾기는 코드
  스팬·링크만 가린(`blockSkip`) 원문을 보므로 수식 안의 `*`를 닫는 구분자로 쓴다. 탈출구는 GitHub와 같은
  `` $`x*y`$ ``이다. 실측: `` *a $`x*y`$ b* ``는 강조와 수식이 둘 다 맞게 나왔다.
- **표 셀 안의 `|`**: GFM 표가 인라인 해석 전에 셀을 나누므로 `$|x|$`는 셀이 갈린다. `\vert`나 `\lvert…\rvert`를
  쓴다(GitHub와 같다).
- **`$$` 블록 안의 빈 줄**: 빈 줄에서 문단이 끝나므로 수식이 끊긴다. 빈 줄이 필요하면 ` ```math ` 펜스를 쓴다.
- `the $n$th`, `US$x$`처럼 수식 바로 앞뒤에 ASCII 영숫자가 붙으면 수식이 아니다(§1의 대가).

## 6. 결정할 것
1. **착수 여부.**
2. **문법 범위**: 세 형태 전부(권장) vs `$…$`만. `` $`…`$ ``는 비용이 거의 없고 §5의 탈출구라서 함께 넣는 편이 낫다.
3. **경계 규칙 R4 수용 여부**: `$n$th`를 포기하고 통화·셸 변수 오인식 0을 얻는다.
4. **헤딩 속 수식의 목차 라벨·앵커**와 **검색 범위**(§4 표의 "예" 두 줄).

## 재현 방법
scratchpad는 세션이 끝나면 사라지므로 핵심만 옮긴다.

**코퍼스 스캔**: `~/projects`·`~/.claude`의 `.md`를 위 제외 목록을 빼고 모은다. 각 파일을 MDV의 `marked.lexer()`로
토큰화하고, `paragraph`·`heading`·`text`(하위 토큰 있음)·표 셀·목록 항목의 하위 토큰을 이어 붙인다. 이때
`codespan`은 공백으로 바꾸고 `code`·`html` 블록은 버린다. 그 결과에 아래 정규식을 건다.

```js
// R4(채택안) — 인라인. 디스플레이는 별도로 먼저 지운다: /(?<![\\$])\$\$([\s\S]+?)\$\$/g
/(?<![\\$A-Za-z0-9])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?![A-Za-z0-9$])/g
```

**v2 프로토타입의 핵심**(marked 9.1.6). 아래 코드를 저장소 루트에서 `node`로 그대로 돌릴 수 있다.

```js
const { Marked, Lexer } = require('marked')                 // MDV의 node_modules(9.1.6)
const katex = require('katex')
const marked = new Marked({ gfm: true, breaks: true })
const baseInlineText = marked.Tokenizer.prototype.inlineText

// 인라인 소스 하나를 선형으로 훑어 [start, end, tex, display] 목록을 만든다.
function scanMath(src) {
  const spans = [], n = src.length
  const nextDollar = k => { while (k < n && src[k] !== '$') { if (src[k] === '\\') k++; k++ } return k }
  let i = 0
  while (i < n) {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] !== '$') { i++; continue }
    if (src[i + 1] === '$') {                        // $$…$$: 줄 시작에서 열고 줄 끝에서 닫는다
      const lineStart = i === 0 || src[i - 1] === '\n'
      let j = i + 2
      while (true) { j = nextDollar(j); if (j >= n || src[j + 1] === '$') break; j++ }
      if (j >= n) break
      const inner = src.slice(i + 2, j), after = src[j + 2]
      if (lineStart && inner.trim() && (after === undefined || after === '\n')) { spans.push([i, j + 2, inner.trim(), true]); i = j + 2 }
      else i += 2
      continue
    }
    const j = nextDollar(i + 1)
    if (j >= n) break
    const inner = src.slice(i + 1, j)
    let ok, tex = inner
    if (inner[0] === '`') { ok = inner.length > 2 && inner.endsWith('`') && !inner.includes('\n\n'); tex = inner.slice(1, -1) }
    else ok = inner !== '' && !/^\s|\s$/.test(inner) && !inner.includes('\n')
      && !/[A-Za-z0-9]/.test(src[j + 1] || '') && !(i > 0 && /[A-Za-z0-9]/.test(src[i - 1]))
    if (ok) { spans.push([i, j + 1, tex, false]); i = j + 1 } else i = j   // 거절된 닫는 $가 다음 후보가 된다
  }
  return spans
}

const baseInlineTokens = Lexer.prototype.inlineTokens
Lexer.prototype.inlineTokens = function (src, tokens) {        // 실제 구현은 인스턴스당 한 번만(가드)
  const saved = this.__mdvMath
  this.__mdvMath = src.includes('$') ? { src, spans: scanMath(src), k: 0 } : null
  try { return baseInlineTokens.call(this, src, tokens) } finally { this.__mdvMath = saved }
}
const at = (lexer, src) => {                                   // 현재 위치와 다음 수식 구간
  const st = lexer.__mdvMath
  if (!st) return null
  const pos = st.src.length - src.length                       // start() 있는 인라인 확장이 없을 때만 성립
  while (st.k < st.spans.length && st.spans[st.k][0] < pos) st.k++
  return { st, pos, next: st.spans[st.k] }
}
marked.use({
  extensions: [{
    name: 'mdvMath', level: 'inline',                           // start() 없음
    tokenizer(src) {
      if (src[0] !== '$') return
      const a = at(this.lexer, src)
      if (!a || !a.next || a.next[0] !== a.pos) return
      a.st.k++
      return { type: 'mdvMath', raw: src.slice(0, a.next[1] - a.pos), text: a.next[2], display: a.next[3] }
    },
    renderer: t => katex.renderToString(t.text, { throwOnError: false, displayMode: t.display, strict: false }),
  }],
  tokenizer: {
    inlineText(src, ...rest) {                                  // 다음 수식 앞에서 자르기만 한다
      const a = at(this.lexer, src)
      return baseInlineText.call(this, a && a.next ? src.slice(0, a.next[0] - a.pos) : src, ...rest)
    },
  },
})
```

**시간 측정**: 같은 입력을 확장 없는 `Marked` 인스턴스와 위 인스턴스에 `parse()`로 넣고 `process.hrtime`으로 잰다.
각각 짧은 입력으로 한 번 데운 뒤 잰다. marked 18은 `lib/marked.esm.js`를 `import`해서 같은 코드를 돌렸다.

## 출처
- GitHub Docs, [Writing mathematical expressions](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions)
- marked 9.1.6 `lib/marked.cjs` — `_Lexer.inlineTokens`의 확장 호출 순서, `cutSrc`, 텍스트 토큰 병합, `blockSkip` 마스킹
- 계획 23(`done/2026-10-01/23-root-scroll-width-and-tilde-strike.md`) — `start()` O(n²)와 `inlineText` 훅 선례
- 계획 24(`24-marked-upgrade.md`) — marked 18 업그레이드 보류 상태
