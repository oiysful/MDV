# 다이어그램

MDV의 구조를 설명하는 정적 다이어그램 5종. 각 HTML은 자체 완결형이라 브라우저로 그냥 열면
된다 — 빌드도, 서버도, 저장소 의존성도 필요 없다.

| 파일 | 타입 | 무엇을 보여주나 |
|------|------|-----------------|
| [mdv-architecture.html](./mdv-architecture.html) | architecture | 사용자 → 렌더러 셸 → preload 브리지 → Electron Main → 파일시스템. 렌더러 샌드박스와 메인 프로세스 특권 영역을 경계로 표시 |
| [mdv-release.html](./mdv-release.html) | workflow | develop의 버전 bump → `develop` → `main` PR(릴리스 결정) → `v*` 태그 → 빌드·Release 게시 → Homebrew 탭 bump. 릴리스 노트 수동 작성과 `HOMEBREW_TAP_TOKEN` 없을 때의 예외 경로 포함 |
| [mdv-open-and-watch.html](./mdv-open-and-watch.html) | sequence | 열기 클릭부터 `file-opened`, `watch-file` 구독, 외부 `change` 감지와 `savedContent` 메아리 판별까지 |
| [mdv-render-pipeline.html](./mdv-render-pipeline.html) | dataflow | 원본 → 전처리(프론트매터 · 로컬 이미지 · 지연 로드) → marked → DOMPurify → `#content` + TOC + 탭 스냅샷 |
| [mdv-tab-lifecycle.html](./mdv-tab-lifecycle.html) | lifecycle | 탭 문서 상태: 열림 → 편집 중 → 저장 완료, 백그라운드 대기와 저장 충돌 복구 루프 |

## 출처

내용은 아래 문서에서 가져왔다. 이 문서들이 바뀌면 다이어그램도 같은 변경에서 갱신한다.

- `AGENTS.md` — IPC 계약, 감시자 구조, CSP/지연 로드, 세션 복원
- `src/AGENTS.md` — 프로세스 경계와 IPC 채널 이름
- `src/renderer/AGENTS.md` — 렌더러 컨트롤러 분할, 탭 상태
- `README.md` — 기능 범위, 배포 경로
- `RELEASING.md` — 릴리스 파이프라인과 필요한 시크릿

## 재생성

**HTML은 직접 편집하지 않는다.** 명세(`*.json`)에서 자동 생성되므로 손으로 고친 내용은 다음
재생성에서 사라진다. 명세를 고쳤으면 HTML을 다시 만들어 같은 커밋에 함께 넣는다.

archify는 이 저장소의 의존성이 아니라 Claude Code 스킬(`/archify`)이다. 스킬 경로를 잡고
`docs/diagrams/`에서 실행한다.

```bash
cd docs/diagrams
ARCHIFY=~/.claude/skills/archify

node $ARCHIFY/bin/archify.mjs deliver architecture mdv-architecture.architecture.json  mdv-architecture.html    --quality showcase
node $ARCHIFY/bin/archify.mjs deliver workflow     mdv-release.workflow.json           mdv-release.html         --quality showcase
node $ARCHIFY/bin/archify.mjs deliver sequence     mdv-open-and-watch.sequence.json    mdv-open-and-watch.html  --quality showcase
node $ARCHIFY/bin/archify.mjs deliver dataflow     mdv-render-pipeline.dataflow.json   mdv-render-pipeline.html --quality showcase
node $ARCHIFY/bin/archify.mjs deliver lifecycle    mdv-tab-lifecycle.lifecycle.json    mdv-tab-lifecycle.html   --quality showcase
```

`deliver`는 아티팩트 검사 9종과 showcase 합성 검사를 모두 통과해야만 HTML을 쓴다. 실패하면
종료 코드가 0이 아니고 기존 HTML은 그대로 남는다. 같은 명세로 다시 돌리면 바이트 단위로 같은
HTML이 나온다.

브라우저 증거(뷰포트별 오버플로 · 글자 크기 측정과 캡처)가 필요하면:

```bash
node $ARCHIFY/bin/archify.mjs visual-check mdv-architecture.html --json
```

이 명령은 `*.visual-check.json` 영수증과 PNG 캡처를 만든다. 언제든 다시 만들 수 있는
산출물이라 `.gitignore`에 넣어 두었다.

## 알아둘 점

- **뷰어 UI는 영어로 고정된다.** 제목 · 노드 · 엣지 · 카드 본문은 한국어지만, 범례
  (`primary data`, `User UI` 등), 상단 `Light / Classic / Present / Export`, 하단
  `PATH / MAP / LENS`, `<html lang="en">`은 렌더러가 소유한 문자열이다. archify의
  `meta.locale`이 `en`과 `zh-CN`만 받아서 한국어로 바꿀 수 없다.
- **문서에 넣을 그림은 Export로 뽑는다.** 브라우저 스크린샷을 찍으면 툴바와 하단 독까지
  같이 들어온다. 뷰어 우측 상단 **Export** 를 쓰면 다이어그램만 PNG/SVG로 나온다.
- **라이프사이클의 라벨 생략은 의도한 것이다.** 본 레일 다섯 전이(`열림 → 저장된 상태`,
  `편집 중 → 저장 시도` 등)는 도착 상태 이름이 이미 결과를 말하고, 이 렌더러의 열 간격
  (36px)에서는 가로 라벨이 반드시 상태 박스를 침범한다. 정보가 있는 다섯 개
  (`다시 입력`, `다른 탭 전환`, `돌아오면 렌더`, `디스크가 다름`, `편집 유지`)는 남겼다.
