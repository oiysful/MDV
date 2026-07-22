# 05. 로컬 파일 링크에 `#앵커`가 붙으면 항상 열기 실패

## 상태
요청 ([`docs/self-check-request.md`](../self-check-request.md) 5번 항목, 2026-07-22)

## 문제
`[text](./README.md#구현-요약-2026-07-20)`처럼 앵커(프래그먼트)가 붙은 로컬 마크다운 링크를 클릭하면 항상 "파일을 찾을 수 없습니다" 오류가 뜬다. 실제 보고된 에러: `링크 열기 실패: 파일을 찾을 수 없습니다: /Users/ian/projects/ian/MDV/docs/plans/done/2026-07-20/README.md#구현-요약-2026-07-20` — 파일 경로 뒤에 `#앵커`가 그대로 붙은 채 파일 존재 여부를 검사하고 있다.

## 근거
- `src/renderer/app-shell.js:108-125` (`bindContentLinkHandler`) — `:112`에서 `link.getAttribute('href')`로 원본 href를 그대로 읽는다. `:113`은 `href.startsWith('#')`인 순수 인페이지 앵커만 걸러내고, "경로+해시" 조합(`./README.md#...`)은 그대로 통과해 `:123`에서 `openLocalLink(href)`를 호출한다.
- `src/renderer/app-shell.js:87-106` (`openLocalLink`) — `:91`에서 `pathUtils.resolveLocalPath(href, docPath)`에 해시가 포함된 원본 href를 그대로 전달한다.
- `src/renderer/path-utils.js:50-62` (`resolveLocalPath`) → `:57-58`에서 `toFsPath(target, baseDir)` 호출.
- `src/renderer/path-utils.js:19-22` (`toFsPath`):
  ```js
  function toFsPath(relative, baseDir) {
    const guarded = escapeBarePercent(relative).replace(/[#?]/g, encodeURIComponent)
    return decodeURIComponent(new URL(guarded, pathToFileUrl(baseDir)).pathname)
  }
  ```
  `#`을 `%23`으로 이스케이프해 URL 파서가 프래그먼트로 읽지 않도록 **의도적으로** 인코딩한 뒤(`escapeBarePercent(...).replace(...)`), 마지막 `decodeURIComponent`에서 다시 리터럴 `#`으로 되돌린다 — 결과적으로 파일시스템 경로 문자열 안에 리터럴 `#`이 그대로 남는다. 이 왕복 자체는 파일명에 실제 `#`이 들어간 로컬 문서(`a#b.md`)를 지원하기 위한 의도된 동작이다.
- `src/main.js:351-373` (`open-local-path` 핸들러) — `:358`의 `fs.promises.stat(targetPath)`가 해시 포함 경로에 대해 당연히 실패하고, `:360`의 에러 메시지 포맷(`파일을 찾을 수 없습니다: ${targetPath}`)이 보고된 에러와 정확히 일치한다. **main.js는 정상 동작 중이다** — 문제는 렌더러가 URL 프래그먼트를 분리하지 않고 넘긴다는 것.

## 원인
`toFsPath`가 `#`을 경로 문자열의 일부로 "탈출"시키는 것은 파일명에 리터럴 `#`이 포함된 경우를 지원하기 위한 의도된 설계다. 그런데 호출부(`openLocalLink`)가 "URL 프래그먼트로서의 `#`"과 "파일명 일부인 `#`"을 구분하지 않고 원본 href를 통째로 넘기기 때문에, `#구현-요약-2026-07-20` 같은 진짜 앵커도 파일명의 일부로 취급되어 존재하지 않는 경로가 만들어진다.

## 제안 방안
`app-shell.js`의 `openLocalLink`(`:87`) 진입부에서 href를 **첫 `#` 기준**으로 분리한다.

```js
async function openLocalLink(href) {
  const hashIndex = href.indexOf('#')
  const targetPath = hashIndex === -1 ? href : href.slice(0, hashIndex)
  // const fragment = hashIndex === -1 ? '' : href.slice(hashIndex + 1) — v1에서는 사용하지 않음
  const docPath = getActiveTab ? getActiveTab()?.path || null : null
  const resolved = pathUtils.resolveLocalPath(targetPath, docPath)
  // ... 이하 동일
}
```

**분리 위치가 호출부인 이유:** `resolveLocalPath`는 링크 전용(호출부 1곳)이고, 이미지 경로 해석은 별도 함수(`resolveLocalImageCandidates`)를 쓴다 — `resolveLocalPath` 내부가 아니라 `openLocalLink`에서 분리하면 이미지 경로 해석에 전혀 영향을 주지 않아 더 안전하다. `element.href`(브라우저가 해석한 절대 URL)의 `.hash`를 쓰는 대신 `getAttribute('href')` 원본을 수동으로 자르는 이유는, `element.href`가 앱 페이지의 base URL 기준으로 해석되어 `docPath` 기준 상대 링크에는 쓸 수 없기 때문이다.

**v2 후속(이번 범위 밖):** 프래그먼트를 파일 오픈 후 스크롤 대상으로 활용하려면 `markdown.js:134`의 위치 기반 id(`h${index}`)를 텍스트 슬러그로 바꿔야 한다 — 이는 문서 *내부* 앵커 링크(`[목차](#어떤-제목)`)에도 똑같이 적용되는 별개의 개선이라, 이번 v1은 프래그먼트를 버리는 것으로 범위를 제한한다.

## 변경 파일
- `src/renderer/app-shell.js` — `openLocalLink` 진입부에 해시 분리 추가.

## 테스트 계획
- `tests/unit/path-utils.test.js:110-114`의 `'../my notes/a#b.md'` 케이스(파일명에 리터럴 `#`이 있는 경우)는 `resolveLocalPath` 자체를 바꾸지 않으므로 회귀 없이 그대로 유효하다.
- 신규 유닛 테스트 대상: `openLocalLink`가 현재 DOM 이벤트 핸들러 내부라 순수 함수가 아니다 — 분리 로직을 `splitHrefFragment(href)` 같은 순수 헬퍼로 추출하면 유닛 테스트 가능(`'./README.md#구현-요약-2026-07-20'` → `{ path: './README.md', fragment: '구현-요약-2026-07-20' }`). 첫 `#` 기준 분리는 항상 결정적이라 모호한 케이스가 없다.
- `tests/electron/smoke.test.js`에 앵커 포함 링크 클릭 시 대상 마크다운 파일이 새 탭으로 정상 열리는 케이스 추가 권장.

## 리스크 / 미결정 사항
- 파일명에 실제 `#`이 포함된 로컬 마크다운 문서를 가리키면서 동시에 앵커도 쓰는 경우(`a#b.md#heading`)는 "첫 `#`에서 분리" 정책상 `a`를 파일로, `b.md#heading`을 프래그먼트로 오인해 깨진다. 이는 극히 드문 케이스이고, "파일명에 리터럴 `#` 지원"과 "URL 프래그먼트 분리"라는 두 기존/신규 결정 사이의 근본적 모호성이라 완벽한 해법은 없다 — v1은 "일반적인 앵커 링크"를 고치는 것으로 범위를 명시하고 남겨둔다.
