# 기여하기

<div align="center">

[English](CONTRIBUTING.md) | **한국어**
</div>

MDV는 [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow)를 사용합니다: `main`은 항상 배포 가능한 상태를 유지하며, 모든 변경은 짧게 사는 브랜치와 풀 리퀘스트를 거쳐 반영됩니다.

## 워크플로

1. `type/short-description` 형식의 이름으로 `main`에서 브랜치를 만듭니다 — `feat/`, `fix/`, `docs/`, `harden/` 등.
2. 작고 집중된 단위로 커밋합니다. 작업이 눈에 보이도록 풀 리퀘스트를 일찍 엽니다.
3. 머지 전에 CI(`.github/workflows/ci.yml`)가 통과해야 합니다: `npm run test:unit`, `npm run test:controller`, 의존성 감사(audit) 게이트, 그리고 Electron 스모크 스위트(`test-electron` 잡, macOS 러너).
4. 푸시하기 전에 최소 한 번은 로컬에서 Electron 스모크 스위트를 실행하세요([AGENTS.md](AGENTS.md)의 테스트 티어 참고) — 이제 CI도 이를 실행하지만, 로컬 실행이 macOS 러너를 기다리는 것보다 실패를 더 빨리 알려줍니다:
   ```
   npm run test:electron
   ```
5. PR을 머지합니다(기존 히스토리와 동일하게 merge commit 방식). 브랜치는 머지 시 자동으로 삭제됩니다.

## 릴리스

[RELEASING.ko.md](RELEASING.ko.md)를 참고하세요.
