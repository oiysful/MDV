# MDV

<div align="center">

[English](README.md) | **한국어**

  <img src="https://gist.githubusercontent.com/oiysful/9a601ec1d827116eaddb16d65df084de/raw/452f0209c31ffa69843d4a65c42733a4ff8f2dd5/MDV-icon.svg" alt="MDV App icon" style="max-width: 100%;display: block;margin: 0 auto;padding: 1rem;">
</div>

MDV는 macOS용 데스크톱 Markdown 에디터 겸 뷰어로, Claude에서 영감을 받은 깔끔한
작성 화면을 제공합니다. 파일 하나를 열거나 폴더 전체를 프로젝트로 열어, 소스
모드나 실시간 분할 미리보기로 편집하고, 다음 실행 시 열려 있던 탭·사이드바
상태·테마가 그대로 복원되어 하던 작업을 바로 이어갈 수 있습니다. GFM 테이블과
체크리스트, 문법 강조가 적용된 코드 블록, Mermaid 다이어그램, LaTeX 수식
렌더링을 지원합니다.

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

**편집 & 렌더링**
- Markdown 미리보기 + 소스 편집 모드, 실시간 분할 뷰
- 편집 중 Enter가 목록·체크박스·`>` 인용 마커를 다음 줄로 이어 씀 (빈 항목에서는 마커를 지우고 빠져나감)
- GFM 테이블, 체크리스트, 문법 강조가 적용된 코드 블록
- 코드 펜스 안에서 바로 렌더링되는 Mermaid 다이어그램과 LaTeX(수식)
- 자동 테마, 라이트 테마, 다크 테마
- 저장 / 다른 이름으로 저장 / 인쇄 / 복사 컨트롤

**탐색 & 구성**
- 드래그로 순서를 바꿀 수 있는 다중 탭 워크플로
- `.md` / `.markdown` 파일을 위한 디렉터리 탐색기
- 커스텀 컨텍스트 메뉴가 있는 TOC / 탐색기 사이드바
- 로컬 파일 링크(상대/절대 경로) 클릭 시 바로 열림 — markdown은 새 탭으로, 그 외 파일은 OS 기본 앱으로
- 탐색기 컨텍스트 메뉴에서 Finder 표시 지원
- 키보드로 접근 가능한 탭 바와 탐색기 트리(roving tabindex, 방향키 내비게이션)

**워크플로 & 신뢰성**
- 열려 있는 파일에 대한 파일 변경 감시
- 세션 복원: 다음 실행 시 열려 있던 탭과 탐색기 루트가 자동으로 다시 열리고, 최근에 열거나 저장한 파일이 macOS Dock의 "최근 항목" 메뉴에 나타남
- 분할 뷰가 활성화되어 있는 동안에는 항상 사이드바가 닫혀 있으며, 종료 시 이전 상태로 복원됨
- 첫 실행 시 빈 상태 안내와 강화된 열기 진입점 온보딩, 경로 표시 토글/닫기용 탐색기 루트 헤더
- ⌘를 누르고 있으면 실제 시스템 단축키가 있는 버튼에 단축키 배지가 표시됨

## 사용 기술

MDV는 전적으로 사용자의 컴퓨터에서 동작합니다: 문서는 디스크에서 읽고 쓰기만 하며, 텔레메트리도 없고 계정·로그인도 전혀 없습니다.

- Electron
- marked, highlight.js, Mermaid, KaTeX — Markdown/다이어그램/수식 렌더링, 화면에 도달하기 전에 DOMPurify로 살균(sanitize)
- chokidar — 파일 감시

## 첫 실행 UX

- 빈 상태로 실행되면 MDV는 우측 상단의 **열기** 진입점을 강조합니다.
- 빈 상태에는 바로 사용할 수 있는 **파일 열기** / **폴더 열기** 액션이 포함됩니다.
- 첫 실행 안내 카드는 다음을 설명합니다:
  - 단일 markdown 파일 열기
  - 폴더를 탐색기로 열기
  - `.md` / `.markdown` 드래그 앤 드롭
  - Finder에서 MDV를 기본 앱으로 수동 설정하기

이 안내 팝업은 닫을 수 있으며, 닫은 상태가 로컬에 기억됩니다.

## 개발

```bash
git clone https://github.com/oiysful/MDV.git
cd MDV
npm install
npm start
```

브랜치, PR, CI 관례는 [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md)에, 릴리스 프로세스는 [RELEASING.ko.md](RELEASING.ko.md)에 있습니다. 전체 아키텍처, 모듈 맵, 테스트 티어 상세는 [AGENTS.md](AGENTS.md)를 참고하세요. 아키텍처·릴리스·시퀀스·데이터 흐름·생명주기 다이어그램은 [docs/diagrams/](docs/diagrams/)에 있습니다.

## 배포용 앱 빌드

패키징된 macOS 빌드 생성:

```bash
npm run build
```

현재 빌드 출력물:

- `dist/mac-arm64/MDV.app`
- `dist/MDV-1.3.0-arm64-mac.zip`

## 배포 참고사항

- MDV는 의도적으로 Apple Developer ID 서명이나 공증 없이 배포됩니다.
- 로컬 설치/업데이트 스크립트는 `CSC_IDENTITY_AUTO_DISCOVERY=false`와 `--publish=never`로 빌드합니다.
- 모든 설치/업데이트 스크립트는 `/Applications/MDV.app`을 교체하고 설치된 앱 번들에 `xattr -dr com.apple.quarantine`을 실행합니다.
- 사용자 계정에서 `/Applications`에 쓰기 권한이 없다면, 적절한 macOS 권한으로 설치/업데이트 명령을 다시 실행하세요.
- `v*` 태그를 푸시하면 릴리스가 자동으로 빌드·게시됩니다. 전체 파이프라인과 필요한 시크릿은 [RELEASING.ko.md](RELEASING.ko.md)를 참고하세요.

## 알려진 제한사항

- 더 친화적인 macOS 배포를 위한 공증(notarization)은 아직 진행되지 않았습니다.
- Homebrew cask와 모든 릴리스 빌드는 Apple Silicon(arm64)만 대상으로 하며, Intel(x64) 빌드는 없습니다.
- 세션 복원은 마지막으로 포커스된 창의 상태(파일 경로 + 활성 탭 인덱스 + 탐색기 루트)만 유지합니다. 다중 창 세션 병합은 v1 범위 밖입니다.
