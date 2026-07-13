# 05. 백그라운드 탭은 감시되지 않는다 (활성 탭만)

## 문제

렌더러는 **창당 파일 하나만** 감시한다.

```js
// src/renderer/document-flow.js:36-42
let watchedPath = null

async function watchFile(path) {
  if (watchedPath === path) return
  if (watchedPath) await api.unwatchFile(watchedPath)   // ← 이전 탭 감시 해제
  watchedPath = path
  if (path) await api.watchFile(path)
}
```

탭을 전환할 때마다(`document-flow.js:73`) 이전 탭의 감시를 끊고 새 탭을 감시한다. 결과적으로:

- 백그라운드 탭이 외부에서 수정돼도 **전혀 알아채지 못한다.**
- 그 탭으로 돌아가면 **낡은 내용을 보여주면서 dirty 표시도 없다.** 사용자는 이게 최신이라고 믿는다.
- 유일한 방어선은 저장 시점의 충돌 검사(`document-flow.js#detectSaveConflict`)뿐이다. 즉 "저장하려는 순간에야" 외부 변경을 알게 된다.

## 왜 중요한가

git 브랜치 전환, 외부 에디터 사용, 포맷터 실행 — 여러 파일이 한꺼번에 바뀌는 상황은 흔하다. 그때 활성 탭 하나만 갱신되고 나머지는 조용히 낡은 채로 남는다.

## 접근

**메인 프로세스는 이미 준비돼 있다.** 최근 워처 재작성으로 경로당 다중 구독자를 지원한다:

```js
// src/main.js:8
const watchers = new Map() // path → { watcher, subscribers: Set<WebContents> }
```

같은 파일을 여러 창이 감시할 수 있고, 마지막 구독자가 빠질 때만 워처를 닫는다. **렌더러가 이 능력을 안 쓰고 있을 뿐이다.**

따라서 이건 렌더러 쪽 변경만으로 끝난다.

1. `document-flow.js`의 단일 `watchedPath`를 **열린 탭 경로 집합**으로 바꾼다.
2. **탭이 열릴 때** `api.watchFile(tab.path)`. **탭이 닫힐 때** `api.unwatchFile(tab.path)`.
3. **탭 전환 시에는 아무것도 안 한다** — 지금의 unwatch/watch 왕복을 제거한다.
4. `workspace.js#handleExternalFileChange`는 이미 `findTabByPath(path)`로 대상 탭을 찾으므로(371-374행) **비활성 탭도 그대로 처리된다.** 다만 활성 탭일 때만 재렌더하는 분기(398행 `if (tab.id === activeTabId)`)가 이미 있어서, 비활성 탭은 내용·dirty 상태만 갱신되고 화면은 건드리지 않는다. **이 구조가 이미 맞다.**

즉 `handleExternalFileChange`는 거의 손댈 필요가 없다. 감시 대상만 넓히면 된다.

## 주의할 점

- **같은 파일을 두 탭에서 열 수 있는가?** `workspace.js#findTabByPathInTabs`가 경로로 탭을 찾고, 같은 파일을 두 번 열면 기존 탭을 재사용한다(e2e에 "opening the same file twice reuses the existing tab" 테스트 존재). 따라서 경로↔탭은 1:1이라 `Set`으로 충분하다.
- **경로 없는 탭**(untitled)은 감시 대상이 아니다. `tab.path`가 null이면 건너뛴다.
- **다른 이름으로 저장** 시 탭의 경로가 바뀐다(`document-flow.js#saveFileAs` → `updateTabAfterSave`). 옛 경로를 unwatch하고 새 경로를 watch해야 한다. **가장 놓치기 쉬운 지점이다.**
- **창을 닫을 때**는 메인이 알아서 정리한다(`main.js#registerWatchSweep` — WebContents 파괴 시 그 창의 모든 구독 해제). 렌더러가 따로 할 일 없다.
- 백그라운드 탭이 dirty인데 외부 변경이 오면 `resolveExternalChangeAction`이 `'confirm'`을 반환해 **모달을 띄운다**(`workspace.js:387`). 보고 있지도 않은 탭 때문에 갑자기 모달이 뜨는 건 나쁜 경험이다.
  → **비활성 탭은 모달을 띄우지 말고 "충돌 있음" 표시만 하고, 그 탭으로 전환할 때 물어보는 게 맞다.** 이 UX 결정이 이 작업의 핵심이며, 그냥 감시만 늘리면 모달 폭탄이 된다.

## 파일

- `src/renderer/document-flow.js` — `watchedPath` → 경로 집합, 탭 열기/닫기/경로변경에 훅
- `src/renderer/workspace.js` — 비활성 탭의 외부 변경은 모달 대신 표시로(위 결정)
- `src/renderer/index.html` — 충돌 표시용 탭 마커(dirty `●`와 구분되는 표식)
- `tests/unit/workspace.test.js` — 비활성 탭 정책 단위 테스트

## 검증

- 단위: 비활성 탭 + 외부 변경 → 모달 아닌 `'mark-conflict'` 정책이 나오는지.
- e2e: 파일 2개를 탭으로 열고 → **비활성 탭의 파일을 디스크에서 수정** → 활성 탭은 그대로, 비활성 탭에 충돌 표시가 뜨는지 → 그 탭으로 전환하면 그때 확인을 묻는지.
- e2e 회귀: 다른 이름으로 저장 후, **새 경로**의 외부 변경이 감지되는지(옛 경로 감시가 남아있지 않은지).
