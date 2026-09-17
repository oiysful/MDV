# 기여하기

<div align="center">

[English](CONTRIBUTING.md) | **한국어**
</div>

MDV는 [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow)를 사용합니다: `main`은 항상 배포 가능한 상태를 유지하며, 모든 변경은 짧게 사는 브랜치와 풀 리퀘스트를 거쳐 반영됩니다.

## 워크플로

1. `type/short-description` 형식의 이름으로 `main`에서 브랜치를 만듭니다 — `feat/`, `fix/`, `docs/`, `harden/` 등.
2. 작고 집중된 단위로 커밋합니다. 작업이 눈에 보이도록 풀 리퀘스트를 일찍 엽니다.
3. 머지 전에 CI가 통과해야 합니다. `.github/workflows/ci.yml`은 문서만 바뀐 경우를 포함해 모든 푸시·PR에서 `npm run test:unit`, `npm run test:controller`, 의존성 감사(audit) 게이트를 돌립니다(약 15초). `.github/workflows/ci-electron.yml`은 Electron 스모크 스위트(macOS 러너, 약 4분)를 돌리며 문서만 바뀐 변경에서는 건너뜁니다. 제외 경로 목록과, `tests/fixtures/*.md`는 왜 계속 트리거해야 하는지는 그 파일에 적혀 있습니다.
4. 푸시하기 전에 최소 한 번은 로컬에서 Electron 스모크 스위트를 실행하세요([AGENTS.md](AGENTS.md)의 테스트 티어 참고) — 이제 CI도 이를 실행하지만, 로컬 실행이 macOS 러너를 기다리는 것보다 실패를 더 빨리 알려줍니다:
   ```
   npm run test:electron
   ```
5. PR을 머지합니다(기존 히스토리와 동일하게 merge commit 방식). 브랜치는 머지 시 자동으로 삭제됩니다.

## 의존성

`.npmrc`에 `min-release-age=7`이 설정되어 있습니다: 게시된 지 7일이 지나지 않은 패키지 버전은 npm이 설치하지 않습니다.

이 설정이 막으려는 공격은 메인테이너 계정 탈취 후의 악성 패치 릴리스입니다. 이런 건 보통 몇 시간 안에 발각되어 unpublish되기 때문에, 위험은 거의 전부 버전이 올라온 직후 며칠에 몰려 있습니다. 이 프로젝트는 릴리스가 나온 당일에 그걸 받아야 할 이유가 없으니, 그 기간만 기다리면 비용 없이 창을 닫을 수 있습니다.

실제로 마주치게 되는 모습은 이렇습니다. `npm install`과 `npm audit fix`는 쿨다운 중인 수정 버전을 건너뛰면서 다음과 같이 **경고만** 출력합니다:

```
npm warn audit ... left at a vulnerable version because a fix is newer than the release-age cutoff
```

실패가 아니라 경고라 스크롤백에서 놓치기 쉽습니다 — 그러니 어떤 권고사항이 고쳐지지 않는 것처럼 보이면, 업스트림이 막혔다고 결론짓기 전에 이 줄부터 확인하세요. 쿨다운이 지난 뒤 감사를 다시 돌리면 됩니다.

`npm audit fix --force`를 쓰거나, 감사를 초록으로 만들려고 숫자를 낮추지 마세요. 둘 다 이 가드가 존재하는 바로 그 기간을 내주는 행위입니다. 기다릴 수 없을 만큼 급한 수정이라면, 그 판단을 의식적으로 내리고 `memory-security.md`에 기록하세요.

CI는 영향을 받지 않습니다. `npm ci`는 `package-lock.json`에 고정된 버전을 설치하며 쿨다운을 참조하지 않습니다. 이 설정이 의미를 갖는 시점은 의존성을 **변경할 때**이고, 그 일은 기여자의 로컬에서 일어납니다.

## 릴리스

[RELEASING.ko.md](RELEASING.ko.md)를 참고하세요.
