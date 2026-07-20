# 06. tab.renderedHTML 스냅샷의 base64 메모리 부풀림

## 상태
완료 (2026-07-20, 커밋 `b73bd81`) — 상세는 [`../plans/README.md`](./README.md#구현-요약-2026-07-20) 참고.

## 문제
탭마다 프리뷰를 다시 그리지 않고 즉시 전환하기 위해 `tab.renderedHTML`에 렌더링된 DOM의 `innerHTML` 문자열을 캐시해 둔다. 로컬 이미지는 렌더링 시점에 `<img src>`가 base64 data URI로 치환되므로, 이 스냅샷 문자열 안에는 탭이 참조하는 모든 로컬 이미지의 **전체 base64 페이로드**가 그대로 박제된다. 이 스냅샷은 탭이 백그라운드에 있는 동안에도, 탭이 닫히기 전까지 계속 메모리에 남는다. 이미지가 많거나 큰 문서를 여러 탭에 열어두면 탭 개수 × 이미지 용량만큼 렌더러 메모리가 불어난다.

## 근거
- **이미지가 실제로 base64로 인라인된다**: `src/renderer/markdown.js:82-109` `resolveRenderedImagePaths()`가 로컬 이미지 후보 경로를 IPC(`api.readImageDataUrl`)로 조회해 data URL을 받아 `img.src = dataUrl`로 직접 덮어쓴다(`markdown.js:100`). 원본 소스 문자열(`img.getAttribute('src')`, `rawSrc`)은 버려지고 DOM에는 base64만 남는다.
- **원본 IPC 핸들러에 크기 제한이 없다**: `src/main.js:334-346` `read-image-data-url` 핸들러는 `fs.promises.readFile`로 파일 전체를 읽어 `data.toString('base64')`로 통째 인코딩한다. 파일 크기 상한이나 다운스케일 없음 — 큰 스크린샷이면 그만큼 큰 문자열이 그대로 온다.
- **`tab.renderedHTML`에 이 base64가 그대로 캡처된다**: `refs.content.innerHTML`을 통째로 문자열화해 저장하는 지점이 최소 8곳이다.
  - `src/renderer/workspace.js:154` (`saveCurrentTabState`, 비-`previewDirty` 경로)
  - `src/renderer/workspace.js:178` (`restoreTabState`, `previewDirty` 재렌더 후)
  - `src/renderer/workspace.js:333` (`createTab`)
  - `src/renderer/workspace.js:444` (`applyExternalContent`)
  - `src/renderer/workspace.js:486` (`handleExternalImageChange`)
  - `src/renderer/app.js:281` (`renderSplitPreview`)
  - `src/renderer/app.js:303` (`ensurePreviewRendered`)
- **탭이 백그라운드여도 스냅샷은 살아있다**: `saveCurrentTabState()`(`workspace.js:133-157`)는 활성 탭을 벗어날 때(`switchToTab`, `workspace.js:346`) 호출되며, `splitMode && previewDirty`가 아닌 한(`workspace.js:150-156`) `renderedHTML`을 그대로 유지한다 — 즉 순수 소스/렌더 모드 탭은 백그라운드로 가도 base64를 포함한 문자열을 계속 들고 있는다.
- **탭당 별도 사본이다 — 공유 캐시와 별개**: `imageDataUrlCache`(`markdown.js:30`)는 경로 키 기준 LRU로 `IMAGE_CACHE_LIMIT = 100`(`markdown.js:13,49-55`)개로 제한되어 창 전체에서 공유된다. 반면 `tab.renderedHTML`은 탭마다 독립적인 문자열이라 이 상한의 적용을 받지 않는다 — 같은 이미지를 참조하는 탭이 N개면 base64 페이로드가 (공유 캐시 1개 + 탭별 스냅샷 N개)만큼 중복 보관된다.
- **`docs/plans/README.md`의 "완료 과정에서 확인된 잔여 항목"** 섹션에 이미 이 문제가 기록되어 있고, 04번(이미지 캐시 무효화) 구현 시 의도적으로 범위 밖으로 뺐다고 명시되어 있다 — 이번 문서가 그 후속.

## 원인
탭 전환 성능을 위해 만든 "마지막 렌더 결과를 문자열로 캐시" 전략이, 이미지 임베딩 전략("base64를 DOM에 직접 굽는다")과 만나면서 캐시 단위가 잘못 잡혔다. 캐시해야 할 것은 "이 탭의 마크다운 → HTML 변환 결과(텍스트, 코드 하이라이트, TOC 등)"인데, 실제로는 "그 변환 결과 + 그 시점에 조회된 모든 이미지의 원본 바이트"까지 같이 캐시되고 있다. 이미지 데이터는 이미 `imageDataUrlCache`가 경로 기준으로 캐시하고 있으므로, 탭 스냅샷에도 같은 데이터를 다시 박제할 이유가 없다.

## 제안 방안
**핵심 아이디어**: 탭 스냅샷에는 base64 자체가 아니라 "어떤 로컬 경로의 이미지였는지"만 남기고, 탭 복원 시 이미 따뜻한 `imageDataUrlCache`에서 즉시(동기적으로) 다시 채워 넣는다. 캐시가 비어 있는 드문 경우에만 기존 비동기 IPC 경로로 재조회한다.

1. **렌더링 시 로컬 경로를 DOM에 남긴다**: `resolveRenderedImagePaths()`(`markdown.js:82-109`)에서 `img.src = dataUrl`을 설정하는 지점(`markdown.js:100`)에 `img.dataset.mdvLocalPath = localPath`(혹은 `data-mdv-src` 속성)를 함께 기록한다. 이미 `localPath`를 알고 있으므로 추가 조회 없이 가능.
2. **스냅샷 캡처를 `markdownController`에 새 함수로 옮긴다**: 예) `captureSnapshotHTML()` — `refs.content.cloneNode(true)`로 클론한 뒤, `clone.querySelectorAll('img[data-mdv-local-path]')`의 `src` 속성만 제거(또는 빈 문자열로 치환)하고 `clone.innerHTML`을 반환. 문자열 정규식이 아니라 DOM 클론+속성 제거를 쓰는 이유: 코드 블록 안에 `data:`로 시작하는 텍스트가 우연히 있어도 오탐하지 않음. 8곳의 `tab.renderedHTML = refs.content.innerHTML` 호출부를 전부 `tab.renderedHTML = markdownController.captureSnapshotHTML()`로 교체.
3. **복원 시 즉시 재수화(rehydrate)한다**: `hydrateFromDom()`(`markdown.js:161-170`, 호출부 `workspace.js:162`)이 `innerHTML` 삽입 직후 `refs.content.querySelectorAll('img[data-mdv-local-path]:not([src])')`를 순회하며 `imageDataUrlCache.get(path)`가 있으면 **동기적으로** `img.src`를 채운다. 대부분의 경우(최근 100개 이미지 이내) 캐시가 따뜻하므로 화면에 깨진 이미지가 노출되는 프레임 자체가 없다.
4. **캐시 미스(LRU 축출된 경우)만 비동기 폴백**: 캐시에 없는 이미지만 `api.readImageDataUrl`로 재조회해 채운다 — 기존 `resolveRenderedImagePaths()`가 하던 것과 동일한 로직을 재사용 가능. 이 경우에만 아주 짧은 시간 동안 `alt` 텍스트나 빈 이미지가 보일 수 있는데, 이는 README가 우려한 "탭 복원 시 이미지가 깨진 채로 보일 위험"의 최소화된 형태(드물고, 일시적이고, 결국 정상 이미지로 채워짐)이지 영구적으로 깨지는 것과는 다르다.
5. **04번(`previewDirty`)과의 상호작용은 건드릴 필요 없음**: `previewDirty`가 true인 경로(`workspace.js:171-185`, `applyExternalContent`, `handleExternalImageChange`)는 이미 `render()`를 다시 호출해 `imageDataUrlCache`와 DOM을 전부 새로 채운 뒤 스냅샷을 캡처한다 — 이 방안은 그 재렌더 결과를 캡처하는 방식만 바꾸는 것이라 얽힘이 생기지 않는다.

**대안으로 검토했으나 기각한 방안**:
- *백그라운드 탭의 `renderedHTML`을 아예 `null`로 비우고 항상 재렌더*: 메모리는 확실히 줄지만, 탭 전환마다 마크다운 파싱 + 하이라이트 + 이미지 재조회를 다시 해야 해서 스냅샷 캐시를 만든 원래 목적(즉시 전환)을 없앤다. 기각.
- *전체 스냅샷 총량에 바이트 예산을 두고 LRU로 축출*: 구현 복잡도가 높고, 여전히 탭당 최소 1장의 큰 이미지만 있어도 예산을 넘길 수 있어 근본 해결이 아님. 기각.

## 변경 파일
- `src/renderer/markdown.js` — `resolveRenderedImagePaths()`에 `data-mdv-local-path` 부여, 신규 `captureSnapshotHTML()` / 재수화 로직(`hydrateFromDom()` 확장 또는 별도 `rehydrateSnapshotImages()`) 추가, `return { ... }` API 목록(`markdown.js:214-223`)에 새 함수 노출.
- `src/renderer/workspace.js` — `tab.renderedHTML = refs.content.innerHTML` 8곳 중 이 파일에 있는 5곳(154, 178, 333, 444, 486)을 `markdownController.captureSnapshotHTML()` 호출로 교체.
- `src/renderer/app.js` — 같은 패턴 2곳(281, 303) 교체.

## 테스트 계획
- **유닛 테스트** (`tests/unit/` 신설 또는 `markdown` 관련 기존 스위트에 추가, jsdom 기반):
  - `captureSnapshotHTML()`이 반환한 문자열에 `"base64,"` 혹은 `imageDataUrlCache`가 준 data URL 원문이 **포함되지 않음**을 검증 (문자열 길이가 라이브 `innerHTML` 대비 대폭 작아짐도 함께 체크).
  - 캐시가 따뜻한 상태에서 재수화 시 `api.readImageDataUrl`(mock)이 **호출되지 않고** `img.src`가 올바른 data URL로 즉시 채워짐을 검증 — "깨진 이미지 프레임 없음"의 구조적 증거.
  - 캐시 미스(강제로 `imageDataUrlCache`에서 제거) 시 폴백 경로가 `api.readImageDataUrl`을 호출해 결국 올바른 `src`로 수렴함을 검증.
- **Electron 스모크 테스트** (`tests/electron/smoke.test.js`): 서로 다른 로컬 이미지를 각각 참조하는 탭 여러 개를 열고 순차 전환한 뒤, 최종적으로 각 탭의 `img.src`가 `data:` 스킴이며 빈 값이 아님을 확인(깨진 이미지 없음 회귀 방지).
- **메모리 측정은 보조 지표로만**: `process.getProcessMemoryInfo()` 등으로 탭 개수 증가에 따른 메모리 증가폭을 비교할 수는 있으나, GC 타이밍·다른 프로세스 부하에 좌우되어 흔들리기(flaky) 쉽다. 하드 어서션은 위 구조적 테스트(문자열에 base64 미포함)로 걸고, 메모리 수치는 수동 검증/참고용으로만 남긴다.

## 리스크 / 미결정 사항
- **`data-mdv-local-path` 속성 이름 확정 필요** — 다른 코드가 참조하는 기존 `data-*` 속성과 충돌하지 않는지 확인 필요(현재 `index.html`/CSS에서 `data-command`, `data-command-element` 등을 쓰고 있어 네이밍은 비어 있는 것으로 보이나 재확인 요).
- **사용자가 마크다운에 직접 base64 data URI를 붙여넣은 경우는 범위 밖**: `resolveRenderedImagePaths()`는 `isExternalUrl()`(`path-utils.js:2-4`)이 `data:` 스킴을 외부 URL로 간주해 건너뛰므로(`path-utils.js:30`) 애초에 로컬 경로로 취급하지 않는다 — 이런 이미지는 `data-mdv-local-path`가 붙지 않아 이번 방안으로 스트리핑되지 않는다. 드문 케이스로 보고 이번 계획에서는 다루지 않음. 발생 빈도가 유의미하면 별도 항목으로 분리 필요.
- **DOM 클론 비용**: `captureSnapshotHTML()`이 매 렌더마다 `cloneNode(true)`를 추가로 수행한다 — 큰 문서에서 체감 지연이 생기는지 확인 필요(코드 하이라이트가 많은 긴 문서 기준으로 실측 권장).
- **재수화 타이밍**: `hydrateFromDom()`은 동기 함수인데 캐시 미스 폴백은 비동기(IPC)다. 동기 함수 내에서 비동기 폴백을 "fire and forget"하는 형태가 될 수밖에 없는데, 그사이 사용자가 다시 탭을 전환하면 레이스가 생길 수 있다 — 기존 `restoreRenderVersion` 패턴(`workspace.js:172`)과 유사한 버전 가드가 필요할 수 있음, 설계 시 확정 필요.
