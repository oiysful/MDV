# 작업 계획 문서

진행 중인 계획 문서는 이 디렉토리에 바로 둔다. 완료된 계획은 완료 시점 날짜로 이름 붙인
`done/<YYYY-MM-DD>/` 하위로 옮겨 배치 단위로 보관한다.

- [done/2026-07-20/](./done/2026-07-20/) — 2026-07-16에 식별된 11개 항목, 2026-07-20 전부 구현·검증 완료.

## 진행 중 — [`docs/self-check-request.md`](../self-check-request.md) 기반 (2026-07-22 조사)

사용자가 직접 작성한 개선 요청 6건을 코드 조사로 검증하고 계획 문서화했다. 각 항목의 상세 근거(파일:라인)·원인·제안 방안은 아래 표에서 링크된 문서 참고.

**이 배치(01~06) 작업은 전부 `fix/self-check-2026-07-22` 브랜치에서 진행한다.** `main`에서 새로 가지치기하지 말고 이 브랜치에 이어서 커밋할 것.

| # | 문서 | 요약 | 상태 |
|---|------|------|------|
| 1 | [01-explorer-active-tab-sync.md](./01-explorer-active-tab-sync.md) | 탭 이동 시 탐색기가 활성 파일을 추적하지 않음 — 탭→탐색기 동기화 자체가 없음 | 요청 |
| 2 | [02-toc-scrollspy-offset-bias.md](./02-toc-scrollspy-offset-bias.md) | 좌측 목차 하이라이트가 실제 스크롤보다 한 항목 뒤처짐 — offsetTop 기준점 오차(≈116px) | 요청 |
| 3 | [03-tab-switch-scroll-animation.md](./03-tab-switch-scroll-animation.md) | 탭 전환/새 문서 열기 시 불필요한 스크롤 애니메이션 — `scroll-behavior:smooth` + 새 탭 스크롤 미리셋 | 요청 |
| 4 | [04-split-view-scroll-boundary-latch.md](./04-split-view-scroll-boundary-latch.md) | 분할뷰 스크롤 경계에서 반대 방향 전까지 먹통 — 앱 코드 결함 미확인, 네이티브 동작 가능성, 재현 판별 필요 | 요청(조사 필요) |
| 5 | [05-local-link-anchor-fragment.md](./05-local-link-anchor-fragment.md) | `#앵커` 붙은 로컬 링크가 항상 열기 실패 — 해시가 파일 경로 문자열에 그대로 섞여 들어감 | 요청 |
| 6 | [06-security-hardening-audit-2026-07-22.md](./06-security-hardening-audit-2026-07-22.md) | 보안 감사 결과 — HIGH 1(로컬 파일 원클릭 실행), MEDIUM 2, LOW 4 | 요청 |

### 권장 착수 순서
1. **#6 (보안, HIGH-1)** — `open-local-path`의 임의 실행 경로는 심각도가 가장 높고 다른 항목과 독립적이라 가장 먼저 처리 권장.
2. **#5, #3, #1** — 서로 다른 파일을 건드리는 독립적인 작은 수정. 병행 가능.
3. **#2** — TOC 오프셋 수정은 #3과 같은 스크롤 관련 영역이지만 다른 파일(`markdown.js` vs `index.html`/`workspace.js`)이라 충돌 없음.
4. **#4** — 코드 수정 전에 재현 판별 실험이 선행되어야 하므로 마지막. 판별 결과에 따라 범위가 "하드닝"으로 축소되거나 "조사 종료"로 닫힐 수 있음.
