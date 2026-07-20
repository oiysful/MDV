# 02. `*-release.sh` 스크립트의 "Assets을 찾을 수 없음" 실패 조사 및 수정

## 상태
완료 (CI 파이프라인만, 2026-07-20, 커밋 `fef6133`) — `.github/workflows/release.yml` 신설은 완료. **기존 v1.0.1 릴리즈 수동 복구는 저장소 쓰기 권한이 필요한 실제 배포 행위라 범위 밖으로 남겨둠**, 별도 사용자 승인 하에 진행 필요. 상세는 [`../plans/README.md`](./README.md#구현-요약-2026-07-20) 참고.

## 문제
`npm run install:release` / `update:release`가 아래 오류로 실패한다.

```
[MDV] ERROR: Release latest ships no MDV .dmg or .zip asset. Releases must have a built artifact attached; see README.
```

사용자가 GitHub에서 직접 확인한 릴리즈 Asset 경로:
- `https://github.com/oiysful/MDV/archive/refs/tags/v1.0.1.zip`
- `https://github.com/oiysful/MDV/archive/refs/tags/v1.0.1.tar.gz`

## 원인 (진단 완료)
위 두 링크는 **GitHub이 태그마다 자동으로 만들어주는 "Source code" 아카이브**다. `.github/workflows/`가 저장소에 아예 존재하지 않고(확인 완료: `ls .github/workflows` → No such file or directory), 이 자동 소스 아카이브는 GitHub Releases API의 `assets` 배열에 포함되지 않는다(별도의 tarball/zipball 엔드포인트에서 생성되는 것으로, "첨부된 릴리즈 자산"이 아님).

즉 `scripts/common.sh#download_latest_release_asset`(common.sh:113-141)의 로직 자체는 정확하다 — `release.assets`에서 `MDV*.dmg`/`MDV*.zip` 패턴을 찾는데, v1.0.1 릴리즈에는 **실제로 electron-builder가 만든 빌드 산출물이 업로드된 적이 없다.** 사용자가 태그만 찍고 GitHub Release를 만들었을 뿐, `npm run build` 결과물을 릴리즈에 첨부하는 과정이 어디에도 없다(수동으로도, CI로도).

**스크립트 버그가 아니라 릴리즈 프로세스 누락.**

## 제안 방안

### 1) CI 기반 자동 릴리즈 파이프라인 신설
`.github/workflows/release.yml` 신규 작성:
- 트리거: `v*` 태그 push
- macOS 러너에서 `npm ci` → `npm run build` (→ [01번 계획](./01-disable-dmg-build.md)에 따라 `.zip` 산출)
- 산출물의 `SHA256SUMS` 생성 (`common.sh#verify_checksum`이 이미 이 파일명을 찾도록 되어 있음 — common.sh:96-111)
- `gh release upload` 또는 `softprops/action-gh-release`로 `.zip` + `SHA256SUMS`를 해당 태그의 릴리즈에 첨부

### 2) 기존 v1.0.1 릴리즈 즉시 복구 (수동, 이 세션 범위 밖)
CI가 준비되기 전까지 `v1.0.1`은 여전히 깨져 있다. 로컬에서 `npm run build` 후 `gh release upload v1.0.1 dist/*.zip dist/SHA256SUMS`로 수동 첨부하거나, CI 워크플로를 만든 뒤 태그를 재발행(re-run)해야 한다. **이 작업은 저장소 쓰기 권한과 실제 배포 판단이 필요해 계획 문서로만 남기고 실행은 사용자 승인 하에 별도로 진행한다.**

### 3) 문서화
`README.md` Distribution Notes 절 또는 `scripts/AGENTS.md`에 "릴리즈에는 반드시 빌드 산출물이 첨부되어야 하며, 이는 `release.yml`이 자동으로 처리한다"는 내용과 CI가 실패했을 때의 수동 첨부 절차를 추가한다.

## 변경 파일
- 신규: `.github/workflows/release.yml`
- `README.md` (Distribution Notes)
- `scripts/AGENTS.md` (선택)

## 테스트 계획
- 가능하면 포크 저장소나 테스트 태그로 워크플로를 실제 실행해 릴리즈에 `.zip`+`SHA256SUMS`가 붙는지 확인
- 첨부 후 `MDV_RELEASE_TAG=<test-tag> npm run install:release`로 `common.sh#download_latest_release_asset`가 성공적으로 자산을 찾는지 검증

## 리스크 / 미결정 사항
- 코드 서명/공증(notarization) 없이 배포 중(README:188) — CI에서도 동일하게 `CSC_IDENTITY_AUTO_DISCOVERY=false --publish=never`를 유지해야 로컬 빌드와 동작이 어긋나지 않는다.
- v1.0.1 기존 릴리즈를 실제로 고칠지(재업로드) 여부는 사용자 결정 필요 — 이 문서는 방법만 제시.
