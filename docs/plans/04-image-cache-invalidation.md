# 04. 이미지 캐시가 파일 변경 시 무효화되지 않음

## 문제

이미지 data URL 캐시가 **경로만** 키로 쓴다.

```js
// src/renderer/markdown.js:30
const imageDataUrlCache = new Map()

// src/renderer/markdown.js:81-86
let dataUrl = imageDataUrlCache.get(localPath)
if (!dataUrl) {
  const res = JSON.parse(await api.readImageDataUrl(localPath))
  ...
  cacheImageDataUrl(localPath, dataUrl)
}
```

LRU 상한 100개(`markdown.js:13, 49-55`)는 무한 증가를 막지만, **디스크의 이미지가 바뀌어도 키가 그대로**다. 그래서 문서에 넣은 다이어그램을 수정하고 저장해도, 앱은 **세션이 끝날 때까지 옛 이미지를 계속 보여준다.**

문서를 다시 열어도, 탭을 닫았다 열어도 마찬가지다. 앱을 재시작해야만 갱신된다.

## 왜 중요한가

이미지를 고치면서 글을 쓰는 흐름(스크린샷·다이어그램 반복 수정)에서 바로 부딪힌다. 사용자는 "내가 저장을 안 했나?" 하고 애먼 곳을 의심하게 된다. 조용히 틀린 걸 보여주는 게 최악이다.

## 접근

두 가지 방법이 있고, **B를 권한다.**

### A. mtime을 캐시 키에 포함

`read-image-data-url`(`src/main.js:317` 부근)이 `fs.promises.stat`으로 `mtimeMs`를 함께 반환하게 하고, 캐시 키를 `` `${path}:${mtimeMs}` ``로 만든다.

- 장점: 정확하다. 파일이 바뀌면 키가 달라져 자동으로 새로 읽는다.
- 단점: **캐시 히트를 위해 매번 stat이 필요하다** — 즉 캐시의 존재 의미(IPC 왕복 회피)가 사라진다. stat 자체가 IPC 왕복이기 때문이다. 캐시를 무력화하는 셈.

### B. 파일 변경 이벤트에 캐시를 비운다 ← **권장**

이미 워처가 있다. 문서가 다시 렌더될 때 캐시를 비우면 된다.

- `markdown.js`에 `clearImageCache()`를 export.
- `workspace.js#handleExternalFileChange`(371행 부근)에서 재렌더 직전에 호출.
- 저장 후 재렌더 경로에서도 호출(내 저장으로 이미지가 바뀌었을 수 있으므로 — 단, 자기 저장 에코는 이제 무시되므로 `document-flow.js#saveFile` 성공 지점에서 호출).

- 장점: stat 왕복이 없다. 캐시는 렌더 한 번 안에서 같은 이미지가 여러 번 나올 때의 중복 읽기를 막는 본래 목적을 그대로 수행한다.
- 단점: 문서를 재렌더하지 않는 한 갱신 안 됨. 하지만 이미지만 바뀌고 문서는 그대로인 경우가 실제로 흔하다 → **아래 보강 필요.**

### B 보강: 이미지 파일 자체를 감시할 것인가?

문서(.md)는 안 바뀌고 참조된 .png만 바뀌는 게 사실 가장 흔한 시나리오다. 이걸 잡으려면 렌더된 이미지 경로들도 워처에 등록해야 한다.

메인 프로세스는 이미 **경로당 다중 구독자**를 지원한다(`main.js:355` 부근, `path → { watcher, subscribers: Set }`). 그러나 렌더러는 창당 파일 하나만 감시한다 — 이건 [05-watch-all-open-tabs.md](05-watch-all-open-tabs.md)와 같은 뿌리의 제약이다.

**권고: 05번을 먼저 하고, 그 위에 이미지 경로 감시를 얹는다.** 05번이 "렌더러가 여러 경로를 감시한다"는 구조를 만들어 주면, 이미지는 그 목록에 경로를 더하는 것으로 끝난다.

단독으로 급히 고쳐야 한다면 B의 기본형(재렌더 시 캐시 비우기)만으로도 "이미지 고치고 문서를 건드리면 갱신됨" 수준은 확보된다.

## 같은 뿌리의 메모리 문제 (함께 볼 것)

`docs/analysis-2026-07-02-supplement.md`가 지적한 것:

> base64 이미지가 포함된 `tab.renderedHTML` 스냅샷을 탭마다 문자열로 들고 있어 이미지 많은 문서 여러 탭이면 메모리가 크게 부풉니다.

`workspace.js`가 탭 전환용으로 `tab.renderedHTML = refs.content.innerHTML`을 저장하는데, 이 시점의 `<img>`들은 이미 **data URL로 치환된 뒤**다. 즉 같은 이미지의 base64가 **캐시에 1번 + 탭 스냅샷마다 1번씩** 중복 보관된다. 100개 LRU 상한은 캐시에만 걸려 있고 스냅샷에는 안 걸린다.

이미지가 많은 문서를 여러 탭 열면 수십 MB가 문자열로 쌓인다. 캐시 무효화와 뿌리가 같으므로(둘 다 "data URL을 어디에 얼마나 들고 있나") **같이 설계하는 게 맞다.**

방향: 스냅샷을 저장하기 전에 `<img src="data:...">`를 원래 경로로 되돌리고(`data-src` 보존), 복원 시 캐시에서 다시 채운다. 그러면 base64의 유일한 사본은 캐시뿐이고 상한도 실제로 의미를 갖는다.

## 파일

- `src/renderer/markdown.js` — `clearImageCache()` export, 캐시 무효화 훅
- `src/renderer/workspace.js` — 외부 변경 재렌더 시 캐시 비우기, 스냅샷에서 data URL 제거
- `src/renderer/document-flow.js` — 저장 후 재렌더 시 캐시 비우기
- (05번 완료 후) 렌더된 이미지 경로를 워처 대상에 추가

## 검증

- 단위: `clearImageCache()` 호출 후 캐시가 비는지. LRU 상한 로직이 그대로인지.
- e2e: 이미지가 있는 md를 열고 → 렌더 확인 → **디스크의 이미지 파일을 다른 내용으로 교체** → 문서 재렌더 트리거 → `img.src`의 data URL이 **달라졌는지** 확인. (data URL 앞 32자만 비교하면 충분.)
