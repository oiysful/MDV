# 09. IPC가 JSON 문자열을 왕복

## 상태
계획 (미착수)

## 문제

`src/main.js`의 `ipcMain.handle` 핸들러 14개 중 12개가 응답을 `JSON.stringify(...)`로 감싸 반환하고, 렌더러 쪽 호출부는 매번 `JSON.parse(await api.xxx(...))`로 다시 풀어서 쓴다. `contextBridge`/`ipcRenderer.invoke`는 [구조화 클론 알고리즘](https://www.electronjs.org/docs/latest/api/context-bridge)을 지원하므로 평범한 객체·배열·null·Date 등은 별도 (역)직렬화 없이 그대로 왕복 가능하다(함수·클래스 인스턴스·Symbol 등만 못 넘긴다). 지금 구조는 필요 없는 이중 직렬화이며, 다음 문제를 동반한다.

- 각 핸들러/호출부 쌍에서 `JSON.stringify`와 `JSON.parse`를 **둘 다** 빠뜨리지 않아야 하는 결합이 생긴다. 실제로 `save-file-dialog`(`main.js:226-227`)는 `cancelled`/`path` 두 키 모두 문자열화하는데, 호출부(`document-flow.js:149`)가 `JSON.parse`를 잊으면 `[object Object]`류의 조용한 버그가 난다.
- 코드베이스 안에 이미 반례가 있다: `file-changed` 이벤트(`main.js:395`)는 `JSON.stringify` 없이 `sub.send('file-changed', { path, content, event })`로 평범한 객체를 그대로 보내고, 렌더러의 `onFileChanged` 콜백(`app-shell.js:73`)도 `JSON.parse` 없이 구조 분해로 바로 받는다. 즉 구조화 클론이 이미 이 앱의 IPC 경로 한 곳에서 실사용 중이며 문제없이 동작한다 — 나머지 12곳만 불필요하게 다른 패턴을 쓰는 것.

## 근거

### `ipcMain.handle` 14개의 반환 패턴 (`src/main.js`)

| # | 채널 | 라인 | 반환 방식 |
|---|------|------|-----------|
| 1 | `read-file` | 156, 158, 164 | `JSON.stringify({ content, filename, path })` / `{ error, code }` |
| 2 | `open-file-dialog` | 168, 174, 182 | `JSON.stringify({ cancelled: true })` / `{ files }` |
| 3 | `open-folder-dialog` | 185, 190, 191 | `JSON.stringify({ cancelled: true })` / `{ path }` |
| 4 | `list-directory` | 194, 205, 207 | `JSON.stringify({ entries })` / `{ error }` |
| 5 | `save-file` | 211, 214, 216 | `JSON.stringify({ ok, filename })` / `{ error }` |
| 6 | `save-file-dialog` | 220, 226, 227 | `JSON.stringify({ cancelled: true })` / `{ path }` |
| 7 | `export-pdf` | 230-249 | `JSON.stringify({ ok, error })` / `{ cancelled: true }` / `{ ok, path, filename }` |
| 8 | `new-window` | 253-255 | **반환값 없음** (직렬화 대상 아님) |
| 9 | `open-external-url` | 257, 260, 263, 265 | `JSON.stringify({ ok, error })` |
| 10 | `reveal-in-finder` | 269-277 | `JSON.stringify({ ok, error })` |
| 11 | `get-markdown-default-app-status` | 281-313 | `JSON.stringify({ ok, registered, ... })` (필드 10개+짜리 큰 객체) |
| 12 | `read-image-data-url` | 334, 339, 342, 344 | `JSON.stringify({ ok, error })` / `{ ok, data_url }` |
| 13 | `watch-file` | 373-401 | **반환값 없음** (직렬화 대상 아님) |
| 14 | `unwatch-file` | 405-407 | **반환값 없음** (직렬화 대상 아님) |

12개 핸들러(#1~#7, #9~#12)가 `JSON.stringify`를 쓴다. 나머지 3개(`new-window`, `watch-file`, `unwatch-file`)는 애초에 값을 반환하지 않으므로 이번 정리 대상에서 자연히 빠진다.

추가로 `ipcMain.handle`은 아니지만 같은 패턴을 쓰는 곳이 하나 더 있다: `sendFile()` 헬퍼(`main.js:73-80`, `createWindow`가 파일을 열 때 호출)가 `win.webContents.send('file-opened', JSON.stringify({...}))`로 이벤트를 보낸다. 이건 request/response가 아니라 push 이벤트이지만 동일하게 불필요한 직렬화다.

**반례(이미 정상 동작 중인 구조화 클론 사용처):** `main.js:395`의 `file-changed` 이벤트는 `sub.send('file-changed', { path: filePath, content, event: changeEvent })`로 평범한 객체를 그대로 보낸다. `JSON.stringify`가 없다.

### `src/preload.js` — 순수 포워딩만 함 (JSON 처리 없음)

`preload.js` 5-19줄의 모든 API 메서드는 `(args) => ipcRenderer.invoke('channel', args)` 형태로만 되어 있고, `JSON.stringify`/`JSON.parse`가 단 한 줄도 없다. 즉 (역)직렬화는 전부 main 쪽(보내기)과 renderer 호출부(풀기) 양단에서만 일어난다 — preload는 이번 정리와 무관.

### 렌더러 쪽 `JSON.parse(await api.xxx(...))` 호출부 — 5개 파일, 13곳

```
src/renderer/document-flow.js:71   const data = JSON.parse(await api.openFileDialog())
src/renderer/document-flow.js:119  const diskResult = JSON.parse(await api.readFile(tab.path))
src/renderer/document-flow.js:127  const res = JSON.parse(await api.saveFile(tab.path, tab.content))
src/renderer/document-flow.js:149  const dlg = JSON.parse(await api.saveFileDialog(tab.filename))
src/renderer/document-flow.js:152  const res = JSON.parse(await api.saveFile(dlg.path, tab.content))
src/renderer/app-runtime.js:96     const res = JSON.parse(await api.revealInFinder(targetPath))
src/renderer/app-runtime.js:102    const status = JSON.parse(await api.getMarkdownDefaultAppStatus())
src/renderer/app-runtime.js:200    const res = JSON.parse(await api.exportPdf(suggestedName))
src/renderer/explorer.js:62        const res = JSON.parse(await api.openFolderDialog())
src/renderer/explorer.js:73        const res = JSON.parse(await api.listDirectory(path))
src/renderer/explorer.js:150       const data = JSON.parse(await api.readFile(entry.path))
src/renderer/app-shell.js:93       const res = JSON.parse(await api.openExternalUrl(href))
src/renderer/markdown.js:95        const res = JSON.parse(await api.readImageDataUrl(localPath))
```

파일별: `document-flow.js` 6곳, `app-runtime.js` 3곳, `explorer.js` 3곳, `app-shell.js` 1곳, `markdown.js` 1곳.

여기에 push 이벤트 쪽 1곳이 더 있다: `document-flow.js:161`의 `handleFileOpened(jsonStr)` 내부에서 `const data = JSON.parse(jsonStr)`로, `sendFile()`이 `file-opened` 이벤트로 보낸 문자열을 다시 푼다(`app-shell.js:69-71`이 `api.onFileOpened(jsonStr => handleFileOpened(jsonStr))`로 그대로 전달).

**총 14곳**(invoke 응답 13곳 + 이벤트 페이로드 1곳)이 `JSON.parse`를 호출하며, 대응하는 main 쪽 13곳(핸들러 12개 + `sendFile`)이 `JSON.stringify`를 호출한다. 정확히 1:1로 대응한다.

`onboarding.js:26`의 `JSON.parse(storage.getItem(...))`는 `localStorage` 값을 읽는 것으로 IPC와 무관 — 이번 정리 대상 아님.

## 원인

프로젝트 초기에 IPC 페이로드를 문자열로 통일해서 다루는 관례가 생겼고(아마 이전 window.postMessage 기반 코드나 다른 프레임워크 습관의 잔재), `contextBridge`가 구조화 클론을 지원한다는 사실과 무관하게 그 관례가 모든 신규 핸들러에 복사돼 굳어졌다. `file-changed` 이벤트 하나만 다른 패턴(평범한 객체)을 쓰는 것으로 보아, 어느 시점부터 두 패턴이 공존하며 관성으로 유지된 것으로 보인다.

## 제안 방안

기계적 일괄 치환. 두 변경을 항상 짝지어서(같은 커밋에서) 수행한다.

**Main 쪽**: `ipcMain.handle`(과 `sendFile`)의 `return JSON.stringify({...})`를 `return {...}`로, 중간의 `JSON.stringify(...)` 호출부도 순수 객체 리터럴로 바꾼다.

```js
// Before (main.js:211-218)
ipcMain.handle('save-file', async (_, filePath, content) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8')
    return JSON.stringify({ ok: true, filename: path.basename(filePath) })
  } catch (e) {
    return JSON.stringify({ error: e.message })
  }
})

// After
ipcMain.handle('save-file', async (_, filePath, content) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8')
    return { ok: true, filename: path.basename(filePath) }
  } catch (e) {
    return { error: e.message }
  }
})
```

**Renderer 쪽**: 대응하는 `JSON.parse(await api.xxx(...))`를 `await api.xxx(...)`로, `JSON.parse(jsonStr)`을 `jsonStr`(그리고 변수명이 이제 JSON 문자열이 아니므로 `payload` 등으로 리네이밍 권장)로 바꾼다.

```js
// Before (document-flow.js:127)
const res = JSON.parse(await api.saveFile(tab.path, tab.content))

// After
const res = await api.saveFile(tab.path, tab.content)
```

`file-changed`(`main.js:395`, `app-shell.js:73-75`)는 이미 목표 상태이므로 손대지 않는다 — 오히려 이 정리가 끝나면 모든 IPC 페이로드가 `file-changed`와 동일한 패턴으로 통일된다.

## 변경 파일

- `src/main.js` — `ipcMain.handle` 12개 핸들러 + `sendFile()` 헬퍼(총 13개 지점)에서 `JSON.stringify` 제거
- `src/renderer/document-flow.js` — 7곳(`JSON.parse(await api...)` 6곳 + `JSON.parse(jsonStr)` 1곳)
- `src/renderer/app-runtime.js` — 3곳
- `src/renderer/explorer.js` — 3곳
- `src/renderer/app-shell.js` — 1곳
- `src/renderer/markdown.js` — 1곳
- `src/preload.js` — 변경 불필요(이미 순수 포워딩)

## 테스트 계획

- 순수 문자열 제거/치환이므로 신규 테스트는 필요 없다. 기존 `tests/unit/*`와 `tests/electron/*`가 IPC 응답의 필드(`ok`, `error`, `entries`, `files` 등)를 이미 검증하고 있으므로, 이 스위트가 그대로 회귀 방지 역할을 한다.
- `npm run test:unit` 전체 통과 확인.
- `npm run test:electron` 전체 통과 확인 — 특히 파일 열기/저장/폴더 탐색/이미지 로드/PDF 내보내기/외부 링크/기본 앱 상태처럼 변경된 핸들러를 실제로 왕복시키는 시나리오.
- 수동 확인 1회: 앱을 띄워 파일 열기 → 편집 → 저장 → 다른 창에서 열기(`file-opened` 경로) → 이미지 삽입 미리보기까지 한 바퀴 돌려 실제 페이로드가 깨지지 않는지 확인.

## 리스크 / 미결정 사항

- **리스크는 낮다.** 타입 정보 손실이나 순환 참조 같은 구조화 클론의 한계에 걸릴 만한 데이터가 없다 — 모든 페이로드가 문자열/불리언/숫자/평면 객체·배열뿐이다(`export-pdf`가 다루는 PDF 바이너리는 `fs.writeFile`로 main 프로세스 안에서만 쓰이고 IPC로 안 넘어간다).
- 기계적 치환이라 실수하기 쉬운 지점은 **핸들러 12곳과 호출부 14곳을 빠짐없이 짝지어 바꾸는 것**뿐이다 — 한쪽만 바꾸면 렌더러가 `[object Object]`를 파싱하려다 예외를 내거나, 반대로 문자열을 그대로 UI에 쓰는 조용한 버그가 난다. 위 표의 지점을 체크리스트로 써서 하나씩 대조하며 진행할 것.
- README(`docs/plans/README.md`)가 이미 "순수 정리 작업이라 급하지 않지만, IPC를 손댈 일이 생기면 같이 처리할 것"이라고 우선순위를 낮게 매겨뒀다 — 이 문서도 같은 판단을 유지한다. 별도로 시간 내서 할 만큼 급하지 않고, 다음에 `main.js`/`preload.js`/렌더러 IPC 호출부 중 하나라도 다른 이유로 건드릴 일이 생기면 그 김에 기계적으로 같이 처리하는 편이 리뷰 비용이 낮다.
