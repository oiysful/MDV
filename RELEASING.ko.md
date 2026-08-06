# 릴리스

<div align="center">

[English](RELEASING.md) | **한국어**
</div>

MDV는 `v*` 태그를 푸시하는 방식으로 릴리스되며, 이는 `.github/workflows/release.yml`을 트리거합니다.

1. `package.json`의 `version`을 올립니다 — `npm version X.Y.Z --no-git-tag-version`을 쓰면 `package.json`과 `package-lock.json`을 한 번에 갱신할 수 있습니다(git 태그는 자동으로 만들지 않도록 스킵 — 태그는 아래 2단계에서 직접 만듭니다). README.md와 README.ko.md의 "배포용 앱 빌드" 섹션에 하드코딩된 `dist/MDV-X.Y.Z-arm64-mac.zip` 예시 경로도 함께 갱신하세요 — 자동으로 채워지는 값이 아니라서 안 챙기면 조용히 오래된 값으로 남습니다. 이 모든 변경을 `Bump version to X.Y.Z` 커밋으로 묶어 `main`에 머지합니다.
2. 태그를 만들고 푸시합니다:
   ```
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. 태그 푸시가 릴리스 워크플로를 트리거합니다: `electron-builder`가 서명되지 않은 macOS `.zip`을 빌드하고, `SHA256SUMS` 파일이 생성되며, 두 파일 모두 `softprops/action-gh-release`를 통해 해당 태그의 GitHub Release에 첨부됩니다.
4. 워크플로는 릴리스 노트를 자동으로 생성하지 **않습니다**(`softprops/action-gh-release` 스텝에 `body`/`generate_release_notes` 설정이 없음) — GitHub Release는 본문이 빈 채로 게시됩니다. 워크플로가 끝나면 노트를 작성해서 붙여주세요:
   ```
   gh release edit vX.Y.Z --notes-file <노트-파일-경로.md>
   ```
5. 이어서 워크플로는 `scripts/update-homebrew-tap.sh`를 실행해서 [`oiysful/homebrew-tap`](https://github.com/oiysful/homebrew-tap)의 `Casks/mdv.rb`에서 `version`/`sha256`을 올리고 그 변경을 `main`에 푸시합니다. 이렇게 해서 `brew upgrade --cask oiysful/tap/mdv`가 새 릴리스를 받아가게 됩니다. 이 단계에는 `HOMEBREW_TAP_TOKEN` 저장소 시크릿이 필요합니다(README의 배포 참고사항 참고). 설정되어 있지 않으면 이 단계는 건너뛰어지고 cask는 수동으로 올려야 합니다.
6. 릴리스를 확인합니다: GitHub Release 페이지에서 `MDV-*.zip`, `SHA256SUMS`, 릴리스 노트를 확인하고, `oiysful/homebrew-tap`의 `Casks/mdv.rb`에 새 버전이 반영되었는지 확인합니다.
