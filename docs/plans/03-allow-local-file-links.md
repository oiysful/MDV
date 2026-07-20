# 03. 실재하는 로컬 파일 링크도 "허용되지 않은 링크입니다" 오류 발생

## 상태
완료 (2026-07-20, 커밋 `5ec5427`) — 상세는 [`../plans/README.md`](./README.md#구현-요약-2026-07-20) 참고.

## 문제
마크다운 본문에 연결된 링크를 클릭했을 때, 그 링크가 실제로 존재하는 파일 경로(상대/절대)를 가리켜도 `링크 열기 실패: 허용되지 않은 링크입니다.` 경고가 뜬다.

## 근거
- `src/renderer/app-shell.js#bindContentLinkHandler` (app-shell.js:86-96): `<a href>` 클릭 시 `#`으로 시작하지 않는 모든 href를 무조건 `api.openExternalUrl(href)`로 넘긴다. 로컬 경로인지 URL인지 구분하지 않음.
- `src/main.js` `open-external-url` 핸들러 (main.js:257-267): `if (!/^https?:\/\//i.test(url))`이면 바로 `{ ok:false, error: '허용되지 않은 링크입니다.' }`를 반환. **http(s) 스킴이 아닌 모든 문자열(상대 경로, 절대 경로, `file://` 등)이 전부 거부된다.**
- `src/renderer/markdown.js`는 렌더링 시 href를 별도로 `file://`화하거나 현재 문서 기준으로 절대 경로화하지 않는다(TOC 앵커(`#h${index}`) 처리만 있음, markdown.js:135-145).

## 원인
`open-external-url` IPC 핸들러는 애초에 "웹 링크만 여는" 용도로 설계됐는데, 렌더러의 콘텐츠 링크 클릭 핸들러가 로컬 파일 링크까지 구분 없이 같은 채널로 보내고 있다. 즉 로컬 파일 링크를 여는 기능 자체가 없다 — 버그라기보다 미구현.

## 제안 방안
1. **경로 분류**: `bindContentLinkHandler`에서 클릭된 href가 `^[a-z][a-z0-9+.-]*:` 형태의 스킴을 갖는지 검사한다.
   - 스킴이 있고 `http(s)`면 기존 `open-external-url` 경로 유지.
   - 스킴이 없으면(상대/절대 파일 경로로 간주) 새 로컬 오픈 경로로 분기.
2. **상대 경로 해석**: 현재 활성 탭의 파일 경로를 기준으로 `path-utils.js`의 기존 헬퍼(또는 신규 헬퍼)를 사용해 절대 경로로 resolve한다. 탭에 파일 경로가 없는 경우(새 미저장 문서) 처리 방침을 정해야 함(예: 무시 + 안내 메시지).
3. **신규 IPC 채널**: `main.js`에 `open-local-path` 같은 핸들러 추가.
   - 대상이 `.md`/`.markdown`이면 새 탭으로 여는 것(기존 파일 열기 흐름 재사용)과, 기타 파일이면 `shell.openPath`로 여는 것 중 선택(마크다운 편집기 성격상 `.md`는 새 탭, 그 외는 OS 기본 앱으로 여는 것을 권장).
   - 경로가 실제로 존재하지 않으면 `허용되지 않은 링크입니다`가 아니라 `파일을 찾을 수 없습니다: <path>` 등 더 정확한 오류로 구분한다(현재 오류 메시지가 "허용 안 됨"이라 사용자가 권한 문제로 오인하기 쉬움).
4. **`preload.js`**에 대응 API 노출 (`openLocalPath` 등).
5. 기존 `open-external-url`의 `^https?://` 화이트리스트는 그대로 유지 — 외부 URL에 대해서는 보안상 올바른 동작이므로 건드리지 않는다.

## 변경 파일
- `src/renderer/app-shell.js` (`bindContentLinkHandler`)
- `src/main.js` (신규 IPC 핸들러)
- `src/preload.js` (API 노출)
- `src/renderer/path-utils.js` (상대 경로 resolve 헬퍼, 필요 시)

## 테스트 계획
- 유닛 테스트: 상대 경로 resolve 헬퍼(현재 파일 디렉터리 기준 `./foo.md`, `../bar/baz.png` 등)
- Electron 스모크 테스트: 폴더를 연 상태에서 상대 링크 클릭 → 새 탭으로 열림 확인; 절대 경로 링크 클릭 확인; 존재하지 않는 경로 클릭 시 명확한 오류 메시지 확인; `https://` 링크는 기존과 동일하게 외부 브라우저로 열리는지(회귀 없음) 확인

## 리스크 / 미결정 사항
- 마크다운이 아닌 로컬 파일(이미지, PDF 등) 링크를 클릭했을 때 새 탭으로 열지, `shell.openPath`로 OS 기본 앱으로 열지, `reveal-in-finder`처럼 Finder에 표시할지 UX 결정 필요 — 사용자 확인 권장.
- 저장되지 않은(경로 없는) 탭에서 상대 링크를 클릭했을 때의 동작 정의 필요.
