# 릴리스

<div align="center">

[English](RELEASING.md) | **한국어**
</div>

릴리스는 `main`을 움직이는 유일한 행위입니다. 작업은 `develop`에서 통합되고, 릴리스는 `develop`에서 `main`으로 여는 명시적 풀 리퀘스트와 그 뒤의 `v*` 태그 푸시로 이루어지며, 태그 푸시가 `.github/workflows/release.yml`을 트리거합니다.

> [!IMPORTANT]
> **v1.4.0(2026-10-12 릴리스)에서 남은 확인.** 확인하면 이 상자를 지우세요.
> - **리뷰 봇 `claude[bot]`(계획 28 7a단계).** 이제 `main`과 `develop`의 `claude-review.yml`이 같아져 Claude GitHub App 경로의 조건을 만족합니다. 다음 `develop` 대상 PR에서 리뷰 코멘트가 `claude[bot]`으로 달리는지 확인하세요. `review` 잡이 초록인데 코멘트가 없으면 로그에서 `Workflow validation failed`, OIDC 오류, App 설치 범위(`oiysful/MDV`만) 순서로 봅니다.
> - **Homebrew cask 형식.** cask는 `depends_on macos: :ventura`입니다 — 기호 하나가 "이 버전 이상"을 뜻하고, 문자열 형식 `">= :ventura"`는 deprecated라 경고가 납니다. `postflight`도 `postflight_steps`로 바꾸라는 경고가 나오지만 1.4.0 이전부터 있던 것이라 그대로 두었습니다.

1. `package.json`의 `version`을 올립니다 — `npm version X.Y.Z --no-git-tag-version`을 쓰면 `package.json`과 `package-lock.json`을 한 번에 갱신할 수 있습니다(git 태그는 자동으로 만들지 않도록 스킵 — 태그는 아래 3단계에서 직접 만듭니다). README.md와 README.ko.md의 "배포용 앱 빌드" 섹션에 하드코딩된 `dist/MDV-X.Y.Z-arm64-mac.zip` 예시 경로도 함께 갱신하세요 — 자동으로 채워지는 값이 아니라서 안 챙기면 조용히 오래된 값으로 남습니다. 이 모든 변경을 `chore(release): bump version to X.Y.Z` 커밋으로 묶고, 다른 변경과 마찬가지로 `develop`에서 브랜치를 만들어 풀 리퀘스트로 `develop`에 머지합니다.
2. `develop`에서 `main`으로 풀 리퀘스트를 열어 머지합니다. 이것이 릴리스라는 행위 자체이며, `main`은 여기서만 움직입니다.
3. `main`의 머지 커밋에 태그를 붙여 푸시합니다:
   ```
   git checkout main && git pull --ff-only
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
   `v*` 태그는 이동·삭제가 막혀 있어서, 잘못 붙인 태그를 조용히 다시 붙일 수 없습니다 — 룰셋을 의도적으로 꺼야 합니다.
4. 태그 푸시가 릴리스 워크플로를 트리거합니다: `electron-builder`가 서명되지 않은 macOS `.zip`을 빌드하고, `SHA256SUMS` 파일이 생성되며, 두 파일 모두 `softprops/action-gh-release`를 통해 해당 태그의 GitHub Release에 첨부됩니다.
5. 워크플로는 릴리스 노트를 자동으로 생성하지 **않습니다**(`softprops/action-gh-release` 스텝에 `body`/`generate_release_notes` 설정이 없음) — GitHub Release는 본문이 빈 채로 게시됩니다. 워크플로가 끝나면 노트를 작성해서 붙여주세요:
   ```
   gh release edit vX.Y.Z --notes-file <노트-파일-경로.md>
   ```
6. 이어서 워크플로는 `scripts/update-homebrew-tap.sh`를 실행해서 [`oiysful/homebrew-tap`](https://github.com/oiysful/homebrew-tap)의 `Casks/mdv.rb`에서 `version`/`sha256`을 올리고 그 변경을 `main`에 푸시합니다. 이렇게 해서 `brew upgrade --cask oiysful/tap/mdv`가 새 릴리스를 받아가게 됩니다. 이 단계에는 `HOMEBREW_TAP_TOKEN` 저장소 시크릿이 필요합니다(아래 [필요한 시크릿](#필요한-시크릿) 참고). 설정되어 있지 않으면 이 단계는 건너뛰어지고 cask는 수동으로 올려야 합니다.
7. 릴리스를 확인합니다: GitHub Release 페이지에서 `MDV-*.zip`, `SHA256SUMS`, 릴리스 노트를 확인하고, `oiysful/homebrew-tap`의 `Casks/mdv.rb`에 새 버전이 반영되었는지 확인합니다.

## 필요한 시크릿

- **`GITHUB_TOKEN`**(`env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`)은 직접 만들어야 하는 저장소 시크릿이 **아닙니다** — GitHub Actions가 모든 워크플로 실행마다 자동으로 주입하는, 해당 실행 범위로 한정된 토큰입니다. 확인해야 할 유일한 사항은 저장소의 **Settings → Actions → General → Workflow permissions**가 "Read and write permissions"(또는 최소한 워크플로 상단에 이미 선언된 `contents: write`에 해당하는 "read" 이상)로 설정되어 있는지입니다 — Actions 권한이 기본값인 read-only로 되어 있는 저장소라면 토큰 자체는 별도 설정이 필요 없더라도 `softprops/action-gh-release`의 업로드 단계가 403으로 실패합니다.
- `GITHUB_TOKEN`과 달리, **`HOMEBREW_TAP_TOKEN`**은 직접 만들어야 하는 저장소 시크릿**입니다**: `oiysful/homebrew-tap`에 쓰기 권한이 있는 fine-grained PAT를 만들어 이 저장소의 **Settings → Secrets and variables → Actions**에 추가해야 합니다. 없으면 `scripts/update-homebrew-tap.sh`가 안내 메시지를 출력하고 종료 코드 0으로 끝납니다(릴리스 자체는 계속 성공하고, tap 업데이트만 건너뜁니다).
