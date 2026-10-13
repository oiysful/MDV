# 다이어그램

MDV의 구조를 설명하는 정적 다이어그램 5종. 각 HTML은 자체 완결형이라 브라우저로 그냥 열면
된다 — 빌드도, 서버도, 저장소 의존성도 필요 없다.

| 파일 | 타입 | 무엇을 보여주나 |
|------|------|-----------------|
| [mdv-architecture.html](./mdv-architecture.html) | architecture | 사용자 → 렌더러 셸 → preload 브리지 → Electron Main → 파일시스템. 렌더러 샌드박스와 메인 프로세스 특권 영역을 경계로 표시. 카드에 UI 언어 결정 경로(`--mdv-locale=` → `api.locale`)와 배포 앱 fuse |
| [mdv-release.html](./mdv-release.html) | workflow | develop의 버전 bump → `develop` → `main` PR(릴리스 결정) → `v*` 태그 → 빌드·Release 게시 → Homebrew 탭 bump. 릴리스 노트 수동 작성과 `HOMEBREW_TAP_TOKEN` 없을 때의 예외 경로 포함. 빌드의 fuse 끄기 · ad-hoc 재서명과 설치 뒤 fuse 확인 |
| [mdv-open-and-watch.html](./mdv-open-and-watch.html) | sequence | 열기 클릭부터 `file-opened`, `watch-file` 구독, 외부 `change` 감지와 `savedContent` 메아리 판별까지 |
| [mdv-render-pipeline.html](./mdv-render-pipeline.html) | dataflow | 원본 → 전처리(프론트매터 · 로컬 이미지 · 지연 로드) → marked → DOMPurify → `#content` + TOC + 탭 스냅샷. 작성자 HTML의 `class`·`style` 제거, 신뢰 토큰 있는 명령 버튼, 목차 강조 즉시 재계산 |
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

archify는 이 저장소의 의존성이 아니라 Claude Code 스킬(`/archify`, 3.0.1 기준)이다. 스킬 경로를
잡고 `docs/diagrams/`에서 실행한다. 3.0부터 각 명세의 `meta.output`(이 디렉터리 기준 HTML
경로)이 필수다.

```bash
cd docs/diagrams
ARCHIFY=~/.claude/skills/archify

node $ARCHIFY/bin/archify.mjs finalize architecture mdv-architecture.architecture.json  mdv-architecture.html    --quality showcase
node $ARCHIFY/bin/archify.mjs finalize workflow     mdv-release.workflow.json           mdv-release.html         --quality showcase
node $ARCHIFY/bin/archify.mjs finalize sequence     mdv-open-and-watch.sequence.json    mdv-open-and-watch.html  --quality showcase
node $ARCHIFY/bin/archify.mjs finalize dataflow     mdv-render-pipeline.dataflow.json   mdv-render-pipeline.html --quality showcase
node $ARCHIFY/bin/archify.mjs finalize lifecycle    mdv-tab-lifecycle.lifecycle.json    mdv-tab-lifecycle.html   --quality showcase
```

`finalize`는 `validate` → `deliver` → `check` → `browser-check`를 차례로 돌리고, 하나라도
실패하면 종료 코드가 0이 아니며 기존 HTML은 그대로 남는다. 실행할 때마다
`*.finalize.json` · `*.delivery.json` · `*.browser-check.json` 같은 영수증이 HTML 옆에 생기는데,
언제든 다시 만들 수 있는 산출물이라 `.gitignore`에 넣어 두었다. 이전 실행의 영수증이 남아
있으면 `browser-check`가 덮어쓰기를 거부하므로(`viewer/evidence-path-conflict`) 다시 돌리기
전에 지운다.

사람이 눈으로 볼 캡처(1440×900 · 2048×1320, 라이트/다크)가 필요하면:

```bash
node $ARCHIFY/bin/archify.mjs visual-check mdv-architecture.html --summary --require-provenance
```

## 알아둘 점

- **뷰어 UI는 영어다.** 제목 · 노드 · 엣지 · 카드 본문은 한국어지만, 범례
  (`primary data`, `User UI` 등), 상단 툴바, 하단 `PATH / LENS`, `<html lang="en">`은
  렌더러가 소유한 문자열이다. 내장 `meta.locale`은 `en`과 `zh-CN`뿐이다. 3.0부터
  `meta.translations`로 다른 언어 번역을 직접 넣을 수 있지만 아직 쓰지 않는다.
- **문서에 넣을 그림은 Export로 뽑는다.** 브라우저 스크린샷을 찍으면 툴바와 하단 독까지
  같이 들어온다. 뷰어 우측 상단 **Export** 를 쓰면 다이어그램만 PNG/SVG로 나온다.
- **라이프사이클의 라벨 생략은 의도한 것이다.** 라벨 없는 다섯 전이(`열림 → 저장된 상태`,
  `편집 중 → 저장 시도`, `저장 완료 → 탭 닫힘` 등)는 도착 상태 이름이 이미 결과를 말한다. 정보가 있는 다섯 개
  (`다시 입력`, `다른 탭 전환`, `돌아오면 렌더`, `디스크가 다름`, `편집 유지`)는 남겼다.
  스키마 v2라 이탈 상태는 떠나는 상태와 같은 열에 둔다(대기 → 편집 중 열, 충돌 → 저장 시도
  열, 종료 → 저장 완료 열). `다시 입력`만 위쪽 채널로 보내는데, 아래로 돌면 `디스크가 다름`과
  교차한다.
- **릴리스 워크플로의 CI 레인에는 그룹 박스를 두지 않는다.** 3.0 라우터에서 그룹 테두리가
  빌드 노드의 위쪽 출구를 막아 `빌드 → 릴리스 노트` 경로가 성립하지 않는다. "태그 하나로
  도는 단일 실행"이라는 사실은 레인 라벨(`태그당 1회 실행`)로 옮겼다.
