# MDV 개선 작업 계획

2026-07-13 감사에서 확인된 미해결 항목들의 구현 계획. 각 문서는 독립적으로 착수 가능하다.

모든 항목은 현재 `main`(PR #1 병합 후 기준) 코드에서 file:line까지 검증했다.

## 우선순위

| # | 작업 | 영향 | 비용 | 문서 |
|---|------|------|------|------|
| 1 | ⌘F가 소스/분할 모드에서 죽은 키 | 높음 | S–M | [01-search-in-editor-modes.md](01-search-in-editor-modes.md) |
| 2 | 네이티브 메뉴에 대부분의 명령 누락 | 높음 | S | [02-native-menu-commands.md](02-native-menu-commands.md) |
| 3 | 가이드 모달에 포커스 트랩/ESC 없음 | 중간 | S | [03-guide-modal-a11y.md](03-guide-modal-a11y.md) |
| 4 | 이미지 캐시가 파일 변경 시 무효화 안 됨 | 중간 | S | [04-image-cache-invalidation.md](04-image-cache-invalidation.md) |
| 5 | 백그라운드 탭은 감시 안 됨 | 중간 | M | [05-watch-all-open-tabs.md](05-watch-all-open-tabs.md) |
| 6 | 에디터에 마크다운 보조 없음 | 높음 | M–L | [06-editor-assistance.md](06-editor-assistance.md) |

**1번부터 하는 것을 권한다.** 사람들이 실제로 글을 쓰는 모드에서 검색이 죽어 있고, 심지어 브라우저 기본 동작까지 막아서 *아무 일도 일어나지 않는* 상태다. 2번은 같은 문제("앱이 자기 기능을 사용자에게 알려주지 않음")의 다른 층위이고 비용이 가장 싸다.

## 이 계획들에 포함되지 않은 미해결 항목

`docs/analysis-2026-07-02.md`와 그 보완 문서(`-supplement.md`)에서 제기됐고 **아직 안 고쳐졌지만** 위 6개에 들어가지 않은 것들. 착수 전에 한 번 읽어볼 것.

> 두 분석 문서는 **수정 전(2026-07-02) 스냅샷**이다. 거기 적힌 버그 대부분은 이미 수정됐고(PR #1) 1건은 오탐으로 판명됐다. 아래 항목만 아직 유효하다.

- **활성 탭이 뷰포트로 스크롤되지 않음** — `#tab-list`가 `overflow-x:auto`인데 스크롤바가 숨겨져 있고, ⌘⇧[ ] 로 탭을 바꿔도 `scrollIntoView`가 호출되지 않는다. 탭이 많으면 **보이지 않는 탭으로 전환된다.** 비용 S, 영향 중간. 6개 중 어디에도 안 들어감.
- **탭·탐색기가 키보드로 도달 불가** — [03번](03-guide-modal-a11y.md)에 배경만 적어뒀다. 별도 작업 권장.
- **`tab.renderedHTML` 스냅샷의 base64 메모리 부풀림** — [04번](04-image-cache-invalidation.md)에 포함시켰다.
- **IPC가 JSON 문자열을 왕복** — 모든 핸들러가 `JSON.stringify` → 렌더러가 `JSON.parse`. contextBridge는 구조화 클론을 지원하므로 불필요한 이중 처리다. 순수 정리 작업이라 급하지 않지만, IPC를 손댈 일이 생기면 같이 처리할 것.
- **세션 복원 / 최근 파일** — 재시작하면 열려 있던 탭·폴더가 전부 사라진다. `localStorage`에 탭 경로만 저장해도 체감이 크다. `app.addRecentDocument`도 macOS 관례.
- **컨트롤러 레벨 테스트 부재** — 단위 테스트는 순수 헬퍼만 다룬다. 실제로 터진 버그들은 대부분 **컨트롤러 간 상호작용**(워처 공유, dirty 덮어쓰기, 검색+탭 전환)에서 나왔다. 모의 refs를 주입하는 컨트롤러 테스트가 다음 투자처.

## 공통 제약

- CommonJS. 프레임워크·번들러·TypeScript 없음.
- 렌더러에서 Node/Electron API 직접 호출 금지. `window.api`(preload) 경유.
- 새 UI 컨트롤은 인라인 핸들러가 아니라 `data-command` + 커맨드 레지스트리(`app.js#createRendererCommands`).
- 메인 메뉴는 `renderer-command` IPC로 렌더러 커맨드를 호출한다(`main.js#sendRendererCommand`).
- 작업 중에는 `npm run test:unit`(0.9초)만 돌리고, 끝낼 때 `npm run test:electron`(~30초) 1회. 자세한 건 `AGENTS.md`의 COMMANDS 참고.
