# 14. 프론트매터 YAML 구조 전면 지원

## 상태
**구현·검증 완료** (2026-08-14). 유닛 200개(신규 15개 포함) + 컨트롤러 12개 + Electron 스모크 84개 전부 통과.

## 배경
프론트매터 메타 카드(2026-08-05 도입, [`done/2026-08-05/10`](../2026-08-05/10-mermaid-support-and-usability-fixes.md))는 실제로는 YAML 파서가 아니라 한 줄짜리 `key: value` 정규식(`^([^:\s][^:]*):\s?(.*)$`)만 매칭하는 라인 스캐너였다. 들여쓰기가 있는 모든 줄(블록 배열, 중첩 객체, 블록 스칼라 본문)은 조용히 소실되고, 인라인 배열은 문자열 그대로 셀에 박히고, 숫자/불리언/null/날짜가 전부 문자열로 취급됐다.

사용자가 "YAML 문법에서 지원하는 구조를 모두" 표현하고 싶다고 요청(객체 배열, 단순 배열, 개행 표기 포함)했다. 이 요구를 정규식 확장으로 커버하려면 들여쓰기 추적 + 블록 스칼라 chomping/폴딩 + 인용 이스케이프까지 YAML 서브셋을 손수 재구현해야 해서 엣지케이스 버그 위험이 컸다. `js-yaml@4.3.1`이 이미 `electron-builder`의 전이 의존성으로 `node_modules`에 존재함을 확인하고, 사용자에게 "정규식 확장" vs "검증된 파서 도입" 중 선택지를 제시해 후자로 확정했다.

## 적용한 해결책

**의존성**: `js-yaml`을 전이 의존성에서 직접 `dependencies`로 승격(이미 트리에 있던 버전이라 락파일 변경 최소). electron-builder는 `dependencies`에 선언된 패키지를 `files` 글롭과 무관하게 자동으로 앱 번들에 포함하므로(marked/dompurify와 동일 방식) 별도 빌드 설정은 불필요.

**브라우저 로딩** (`index.html`): `node_modules/js-yaml/dist/js-yaml.min.js`는 UMD 빌드로 `<script>` 태그로 로드되면 `global.jsyaml`을 전역에 심는다(직접 확인). marked/highlight.js/dompurify와 같은 eager-load 블록에 추가 — 프론트매터 검사가 모든 문서 렌더링 시작 시 무조건 실행되므로 mermaid/katex처럼 지연 로드하지 않는다.

**파서 교체** (`markdown.js#extractFrontmatter`): 구분자 탐색 로직(라인 0이 `---`인지, 닫는 `---` 찾기 — marked의 hr/heading 토크나이저와의 모호성 회피용, YAML 파싱과 무관)은 그대로 두고, 필드 추출만 `yamlLib.load(raw)`로 교체:
- 파싱 실패(잘못된 들여쓰기, 안 닫힌 인용부호 등) → "닫는 `---` 없음"과 동일하게 `frontmatter: null`, 원본 텍스트 그대로 통과 — 애매하면 건드리지 않는다는 기존 파일의 철학과 일치.
- 최상위가 매핑이 아니면(배열/스칼라) → 동일하게 폴백.
- `value`는 이제 string/number/boolean/null/Date/array/object 중 실제 파싱된 타입(기존엔 전부 string이었음 — 의도된 변화).
- `yamlLib`은 `globalScope.jsyaml || (typeof require === 'function' ? require('js-yaml') : null)`로 해석 — 브라우저(nodeIntegration:false, `require` 없음)에서는 스크립트 태그가 심어둔 전역을, Node 유닛테스트(`require()`)에서는 실제 `require('js-yaml')`을 쓴다. `sanitizeHtml`이 DOMPurify 부재 시 `escapeHtml`로 강등하는 것과 같은 톤의 폴백.

**값 렌더러 재작성** (`renderFrontmatterValue`/`renderFrontmatterObject`, 재귀): 타입별 분기를 재귀로 처리해 임의 깊이 중첩(배열의 배열, 객체를 담은 배열 등)까지 특수 케이스 없이 한 경로로 커버.
- 단순 배열(`tags: [a,b,c]` 또는 블록 `- a\n- b`) → `<ul class="frontmatter-list">`.
- 객체 배열(`- name: x\n  value: y`) → 배열 분기가 각 항목마다 재귀 호출 → 항목마다 중첩 `<table class="frontmatter-nested">`가 `<li>` 안에 들어감(별도 특수 케이스 불필요).
- 중첩 객체 → `typeof value === 'object'` 분기로 중첩 테이블.
- 개행 표기(`|`/`>`/`|-`/`>-`/`|+`/`>+`) → js-yaml이 스펙대로 접기/청킹을 다 처리해 순수 JS 문자열로 반환하므로, 렌더러는 남은 `\n`을 `.frontmatter-multiline`(`white-space: pre-wrap`)으로 시각적으로 보존하기만 하면 됨.
- 날짜 → js-yaml 기본 스키마가 무인용 ISO 스칼라를 `Date` 객체로 해석. 자정 UTC면 `YYYY-MM-DD`만, 아니면 전체 ISO로 되돌려 표시.
- 기존 `sanitizeHtml`(DOMPurify 기본 allowlist)이 카드 HTML 전체에 그대로 적용되므로 `<ul>/<li>/<table>` 추가는 별도 sanitizer 설정 변경 없이 안전.

## 변경 파일
- `package.json`, `package-lock.json` (`js-yaml` 직접 의존성 승격)
- `src/renderer/index.html` (js-yaml eager-load `<script>`, `.frontmatter-list`/`.frontmatter-nested`/`.frontmatter-multiline` CSS)
- `src/renderer/markdown.js` (`yamlLib` 해석, `extractFrontmatter` 재작성, `renderFrontmatterValue`/`renderFrontmatterObject`/`formatFrontmatterDate` 신규, `renderFrontmatterCard` 값 렌더러 위임)
- `tests/unit/markdown.test.js` (날짜 타입 변경에 맞춰 기존 테스트 갱신, 배열/객체 배열/중첩 객체/블록 스칼라/타입/오류 폴백/XSS 이스케이프 신규 15건)
- `AGENTS.md` (js-yaml eager 로딩, 프론트매터 YAML 파싱/렌더링 아키텍처 문서화)

## 테스트 계획 (완료)
- `npm run test:unit`: 185/185 통과(신규 15건 포함).
- `npm run test:controller`: 12/12 통과 — 프론트매터 무관 회귀 없음.
- `npm run test:electron`: 84/84 통과 — 새 eager-load `<script>` 태그가 실제 Electron/CSP 환경에서도 앱 부팅·문서 렌더링을 깨지 않음을 확인.

## 리스크 / 후속 과제
- js-yaml 기본 스키마는 YAML 1.1 관례(`yes`/`no`/`on`/`off` → boolean, 무인용 ISO 날짜 → `Date`)를 따른다 — 실사용 중 프론트매터에 이런 값을 문자열로 의도했는데 타입이 바뀌어 놀라는 경우가 나오면, 스키마를 `JSON_SCHEMA`로 좁히는 것도 고려할 수 있으나 이번엔 "실제 YAML 문법 그대로"가 요구사항이라 기본 스키마를 유지했다.
