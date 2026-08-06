# MDV

<div align="center">

[English](README.md) | **한국어**

  <img src="https://gist.githubusercontent.com/oiysful/9a601ec1d827116eaddb16d65df084de/raw/452f0209c31ffa69843d4a65c42733a4ff8f2dd5/MDV-icon.svg" alt="MDV App icon" style="max-width: 100%;display: block;margin: 0 auto;padding: 1rem;">
</div>

Electron으로 만든 Claude 스타일의 데스크톱 Markdown 에디터입니다.

> [!IMPORTANT]
> MDV는 **서명되지 않은(unsigned) macOS 앱**으로 배포됩니다. 이 프로젝트에는 Apple Developer ID 서명이나 공증(notarization)이 없습니다.
> 아래의 설치/업데이트 스크립트는 MDV를 로컬에서 빌드하거나 설치하고, `MDV.app`을 `/Applications`에 복사한 뒤 `xattr -dr com.apple.quarantine`으로 macOS의 quarantine 속성을 제거하여 Gatekeeper 마찰을 줄입니다.

## 설치 / 업데이트

MDV는 세 가지 배포 경로를 지원합니다: Homebrew, GitHub Release 설치, 그리고 이 저장소에서의 직접 로컬 빌드.

### Homebrew로 설치

```bash
brew install --cask oiysful/tap/mdv
```

이 명령은 [`oiysful/homebrew-tap`](https://github.com/oiysful/homebrew-tap) cask를 사용하며, 아래 `install:release` 경로와 동일한 `MDV-*-arm64-mac.zip` 릴리스 애셋을 추적하고 설치 후 quarantine 속성을 자동으로 제거합니다. Apple Silicon(arm64) 전용입니다 — [알려진 제한사항](#알려진-제한사항) 참고.

참고: `brew`로 한 번에 설치하려면 전체 `<user>/<repo>/<cask>` 형식이 필요합니다 — `oiysful/tap`만으로는 해석되지 않습니다. 한 번 tap한 뒤(`brew tap oiysful/tap`)에는 짧은 `mdv` 이름도 동작하지만, `--cask` 없이 그냥 `brew install mdv`를 실행하면 동일한 이름을 가진 무관한 Homebrew Core formula가 대신 설치되므로, 스크립트/문서에서는 항상 `--cask`와 전체 경로를 함께 사용하세요.

업데이트:

```bash
brew upgrade --cask oiysful/tap/mdv
```

### 소스에서 직접 빌드

저장소를 클론해서 직접 앱을 빌드하고 싶을 때 사용합니다.

```bash
git clone https://github.com/oiysful/MDV.git
cd MDV
npm run install:local
```

같은 클론에서 이후 업데이트할 때:

```bash
cd MDV
npm run update:local
```

`update:local`은 `git pull --ff-only origin main`을 실행하고, 의존성을 재설치하고, 서명 없이 다시 빌드한 뒤 `/Applications/MDV.app`을 교체합니다.

### GitHub Releases에서 설치

릴리스 산출물이 이미 있고 로컬에서 빌드하고 싶지 않을 때 사용합니다.

```bash
npm run install:release
```

이후 릴리스 기반 업데이트:

```bash
npm run update:release
```

기본적으로 릴리스 스크립트는 최신 GitHub Release를 설치합니다. 특정 태그를 설치하려면:

```bash
MDV_RELEASE_TAG=v1.0.0 npm run install:release
```

## 기능

- Markdown 미리보기 + 소스 편집 모드
- 드래그로 순서를 바꿀 수 있는 다중 탭 워크플로
- `.md` / `.markdown` 파일을 위한 디렉터리 탐색기
- 커스텀 컨텍스트 메뉴가 있는 TOC / 탐색기 사이드바
- 자동 테마, 라이트 테마, 다크 테마
- 저장 / 다른 이름으로 저장 / 인쇄 / 복사 컨트롤
- 열려 있는 파일에 대한 파일 변경 감시
- 첫 실행 시 빈 상태 안내 및 강화된 열기 진입점 온보딩
- 경로 표시 토글 및 닫기를 위한 탐색기 루트 헤더 액션
- 탐색기 컨텍스트 메뉴에서 Finder 표시 지원
- 로컬 파일 링크(상대/절대 경로) 클릭 시 바로 열림 — markdown은 새 탭으로, 그 외 파일은 OS 기본 앱으로
- 세션 복원: 다음 실행 시 열려 있던 탭과 탐색기 루트가 자동으로 다시 열리고, 최근에 열거나 저장한 파일이 macOS Dock의 "최근 항목" 메뉴에 나타남
- 분할 뷰가 활성화되어 있는 동안에는 항상 사이드바가 닫혀 있으며, 종료 시 이전 상태로 복원됨
- 키보드로 접근 가능한 탭 바와 탐색기 트리(roving tabindex, 방향키 내비게이션)
- ⌘를 누르고 있으면 실제 시스템 단축키가 있는 버튼에 단축키 배지가 표시됨
- `electron-builder`를 통한 macOS 배포용 빌드, 태그된 GitHub Release에 빌드 산출물을 첨부하는 CI 워크플로 포함

## 기술 스택

- Electron
- chokidar
- marked
- highlight.js
- DOMPurify

렌더러 라이브러리는 로컬에 번들되어 `src/renderer/index.html`이 `node_modules/`에서 불러오며, CSP는 원격 스크립트 출처를 전혀 허용하지 않습니다. 렌더링된 markdown은 DOM에 도달하기 전에 DOMPurify로 살균(sanitize)됩니다.

## 렌더러 구조

렌더러는 더 이상 하나의 인라인 `<script>` 블록이 아닙니다.

현재 분리 구조:

- `src/renderer/index.html` — 셸 마크업 + CSS + script 태그
- `src/renderer/app.js` — 컨트롤러 모듈을 연결하고 렌더러 커맨드 레지스트리를 생성하는 얇은 렌더러 부트스트랩
- `src/renderer/app-runtime.js` — 빈 상태, 단축키, 툴바 액션을 위한 공유 렌더러 커맨드/런타임 오케스트레이션
- `src/renderer/app-shell.js` — DOM ref 수집, 시작 시 와이어링, `data-command` 바인딩, 공유 셸 이벤트 처리
- `src/renderer/document-flow.js` — 파일 열기/저장/다른 이름으로 저장/감시 라이프사이클
- `src/renderer/workspace.js` — 탭 상태, 탭 바 렌더링/키보드 내비게이션, dirty 추적, 세션-탭 보고
- `src/renderer/editor.js` — 소스/분할 모드 전환, 분할 뷰 사이드바 강제 숨김
- `src/renderer/explorer.js` — 탐색기 트리와 루트/헤더 상태 소유권, 키보드 내비게이션, 세션 루트 복원
- `src/renderer/roving.js` — 탭 바와 탐색기 트리가 공유하는 roving-tabindex 인덱스 계산
- `src/renderer/context-menu.js` — 플로팅 컨텍스트 메뉴 컨트롤러
- `src/renderer/shell-actions.js` — 추가 메뉴, welcome-guide 진입 액션, 드래그 앤 드롭 처리
- `src/renderer/path-utils.js` — 경로/링크 헬퍼 로직
- `src/renderer/theme.js` — 테마 상태 + 스타일시트 전환
- `src/renderer/search.js` — 문서 내 검색 컨트롤러
- `src/renderer/onboarding.js` — 첫 실행 / 진입점 안내 / 토스트 UI 로직
- `src/renderer/markdown.js` — markdown 렌더링, 통계, TOC, 이미지 경로 해석, 스냅샷 캡처/재수화(rehydration)
- `src/renderer/session-state.js` — 순수 세션 형태 빌더 + 빈 세션 가드

렌더러 커맨드 진입점은 이제 그룹화된 `rendererCommands` 레지스트리, 위임된 `data-command` 리스너, 생성된 복사 버튼 위임, 메인 메뉴에서 오는 명시적 `renderer-command` IPC를 거쳐 라우팅됩니다.

## 테스트

이 프로젝트는 더 결합도가 높은 워크스페이스 상태를 건드리기 전에 렌더러 리팩터링을 보호하기 위한 경량 테스트 레이어를 포함합니다.

### 유닛 테스트

```bash
npm run test:unit
```

다음과 같은 순수 헬퍼들을 커버합니다:
- 경로 해석
- 외부 URL 감지
- markdown 읽기 시간 통계 계산
- roving-tabindex 인덱스 계산
- 세션 상태 형태 빌딩 및 빈 세션 가드

### 컨트롤러 테스트

```bash
npm run test:controller
```

유닛 티어와 Electron 티어 사이에 위치합니다: Electron을 부팅하지 않고 jsdom 위에서 2~3개의 실제 컨트롤러 팩토리(스텁이 아님)를 함께 구동해서, 순수 헬퍼 유닛 테스트로는 볼 수 없는 컨트롤러 간 배선(wiring) 회귀 — 예를 들어 다른 컨트롤러에 도달하지 못하게 된 콜백 — 를 잡아냅니다.

### Electron 스모크 테스트

```bash
npm run test:electron
```

완전한 end-to-end 스위트 없이 실제 Electron 동작을 커버합니다:
- 앱 부팅 / 빈 상태
- 파일 열기 흐름
- 메인 프로세스 `file-opened` 흐름
- 저장 / 다른 이름으로 저장 동작
- 파일 워처 재연결 및 외부 변경 새로고침
- 폴더 열기 / 탐색기 필터링
- 공유 컨텍스트 메뉴 동작
- 추가 메뉴 및 드래그/드롭 셸 액션
- window 커맨드 전역 변수나 인라인 핸들러 없는 렌더러 커맨드 디스패치
- 테마 전환 동작
- 로컬 파일 링크 열기(markdown은 새 탭으로, 그 외 파일은 OS 기본 앱으로, 파일 없음 오류)
- Cmd-hold 단축키 배지
- 분할 뷰 사이드바 강제 숨김/복원
- 탭 스크롤-into-view 및 키보드로 접근 가능한 탭 바 / 탐색기 트리
- 세션 복원, 빈 세션 가드, 재실행 시 최근 문서 등록

픽스처 콘텐츠는 `tests/fixtures/`에 있습니다.

## 첫 실행 UX

- 빈 상태로 실행되면 MDV는 우측 상단의 **열기** 진입점을 강조합니다.
- 빈 상태에는 바로 사용할 수 있는 **파일 열기** / **폴더 열기** 액션이 포함됩니다.
- 첫 실행 안내 카드는 다음을 설명합니다:
  - 단일 markdown 파일 열기
  - 폴더를 탐색기로 열기
  - `.md` / `.markdown` 드래그 앤 드롭
  - Finder에서 MDV를 기본 앱으로 수동 설정하기

이 안내 팝업은 닫을 수 있으며, 닫은 상태가 로컬에 기억됩니다.

## 프로젝트 구조

```text
./
├── src/
│   ├── main.js
│   ├── preload.js
│   └── renderer/index.html
├── assets/
│   └── icon.icns
├── package.json
└── AGENTS.md
```

## 개발

의존성 설치:

```bash
npm install
```

데스크톱 앱을 로컬에서 실행:

```bash
npm start
```

브랜치, PR, CI 관례는 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md)에, 릴리스 프로세스는 [RELEASING.ko.md](RELEASING.ko.md)에 있습니다.

## 배포용 앱 빌드

패키징된 macOS 빌드 생성:

```bash
npm run build
```

현재 빌드 출력물:

- `dist/mac-arm64/MDV.app`
- `dist/MDV-1.1.0-arm64-mac.zip`

## 배포 참고사항

- MDV는 의도적으로 Apple Developer ID 서명이나 공증 없이 배포됩니다.
- 로컬 설치/업데이트 스크립트는 `CSC_IDENTITY_AUTO_DISCOVERY=false`와 `--publish=never`로 빌드합니다.
- 모든 설치/업데이트 스크립트는 `/Applications/MDV.app`을 교체하고 설치된 앱 번들에 `xattr -dr com.apple.quarantine`을 실행합니다.
- 사용자 계정에서 `/Applications`에 쓰기 권한이 없다면, 적절한 macOS 권한으로 설치/업데이트 명령을 다시 실행하세요.
- `v*` 태그를 푸시하면 `.github/workflows/release.yml`이 트리거되어, macOS 러너에서 동일한 서명되지 않은 `.zip`을 빌드하고 `SHA256SUMS` 파일과 함께 해당 태그의 GitHub Release에 첨부합니다. `npm run install:release` / `update:release`는 이 애셋들이 존재한다는 것을 전제로 하므로 — 릴리스 실행이 완료되지 않은 태그에는 다운로드 가능한 빌드가 없습니다. 릴리스 실행이 실패했거나 이 워크플로가 생기기 전에 태그가 푸시된 경우에는 로컬에서 빌드하고 산출물을 수동으로 첨부하세요: `npm run build -- --publish=never`를 실행한 뒤, `shasum -a 256 dist/MDV-*.zip > dist/SHA256SUMS`, 그리고 `gh release upload <tag> dist/MDV-*.zip dist/SHA256SUMS`.
- 워크플로의 `GITHUB_TOKEN`(`env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`)은 직접 만들어야 하는 저장소 시크릿이 **아닙니다** — GitHub Actions가 모든 워크플로 실행마다 자동으로 주입하는, 해당 실행 범위로 한정된 토큰입니다. 확인해야 할 유일한 사항은 저장소의 **Settings → Actions → General → Workflow permissions**가 "Read and write permissions"(또는 최소한 워크플로 상단에 이미 선언된 `contents: write`에 해당하는 "read" 이상)로 설정되어 있는지입니다 — Actions 권한이 기본값인 read-only로 되어 있는 저장소라면 토큰 자체는 별도 설정이 필요 없더라도 `softprops/action-gh-release`의 업로드 단계가 403으로 실패합니다.
- `GITHUB_TOKEN`과 달리, `HOMEBREW_TAP_TOKEN`은 직접 만들어야 하는 저장소 시크릿**입니다**: `oiysful/homebrew-tap`에 쓰기 권한이 있는 fine-grained PAT를 만들어 이 저장소의 **Settings → Secrets and variables → Actions**에 추가해야 합니다. 없으면 `scripts/update-homebrew-tap.sh`가 안내 메시지를 출력하고 종료 코드 0으로 끝납니다(릴리스 자체는 계속 성공하고, tap 업데이트만 건너뜁니다).

## 보안 / 아키텍처 참고사항

- 렌더러 코드는 권한이 필요한 동작에 대해서만 `window.api`를 사용해야 합니다.
- 새로운 권한이 필요한 파일시스템/셸 동작은 다음 두 곳 모두에 추가해야 합니다:
  - `src/main.js`
  - `src/preload.js`
- Finder 표시는 렌더러에서 직접 접근하지 않고 preload/main 브리지를 통해 구현되어 있습니다.

## 알려진 제한사항

- `src/renderer/app.js`와 `src/renderer/app-runtime.js`는 여전히 다음 구조적 소유권 정리 대상입니다.
- 더 친화적인 macOS 배포를 위한 공증(notarization)은 아직 진행되지 않았습니다.
- Homebrew cask와 모든 릴리스 빌드는 Apple Silicon(arm64)만 대상으로 하며, Intel(x64) 빌드는 없습니다.
- 세션 복원은 마지막으로 포커스된 창의 상태(파일 경로 + 활성 탭 인덱스 + 탐색기 루트)만 유지합니다. 다중 창 세션 병합은 v1 범위 밖입니다.
