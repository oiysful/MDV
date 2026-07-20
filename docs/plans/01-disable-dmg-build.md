# 01. 빌드 시 `.dmg` 생성 중단

## 상태
계획 (미착수)

## 문제
`npm run build`(`electron-builder`)를 돌리면 `dist/MDV-1.0.0-arm64.dmg`가 생성된다. 사용자는 이 `.dmg` 산출물이 더 이상 생기지 않길 원한다.

## 근거
- `package.json#build.mac.target` = `"dmg"` (package.json:33-36)
- `README.md:181-184` "Current build outputs"에 `.dmg` 경로가 명시돼 있음
- `scripts/install-local.sh#resolve_local_build_path`는 `dist/mac*/MDV.app` **압축 해제된 앱 번들 디렉터리**만 찾는다(scripts/install-local.sh 미확인 파일이지만 `common.sh`의 동명 함수가 동일 계약을 가짐) — electron-builder는 최종 패키징 타깃과 무관하게 이 중간 산출물을 항상 만들기 때문에, dmg를 꺼도 로컬 설치 스크립트는 영향을 받지 않는다.
- `scripts/common.sh#download_latest_release_asset`는 이미 `.dmg` 우선, 없으면 `.zip`을 찾는 순서로 되어 있어(common.sh:120-128) `.zip`으로 전환해도 릴리즈 설치 스크립트가 깨지지 않는다.

## 원인
`electron-builder`의 `mac.target`이 `"dmg"`로 고정되어 있어 빌드할 때마다 무조건 `.dmg`를 만든다.

## 제안 방안
1. `package.json#build.mac.target`을 `"zip"`으로 변경한다. (`dmg`를 완전히 빼고 `zip`만 남긴다 — `hdiutil` 마운트 단계가 없어 CI에서도 더 빠르고 가볍다.)
2. `README.md:181-184` "Current build outputs" 절을 `.dmg` → `.zip` 경로로 갱신한다.
3. `scripts/install-local.sh`, `scripts/update-local.sh`가 `.dmg`를 직접 참조하는 부분이 있는지 확인(현재 조사로는 `resolve_local_build_path`만 사용하므로 영향 없음으로 추정, 착수 시 재확인 필요).

## 의존 관계
- [02. 릴리즈 스크립트 Asset 조회 실패](./02-release-asset-pipeline.md)와 직결됨 — CI/릴리즈 파이프라인이 업로드해야 할 산출물 종류(`.zip`)가 이 계획에서 결정된다.

## 테스트 계획
- `npm run build` 실행 후 `dist/`에 `.dmg`가 없고 `.zip` + `dist/mac-arm64/MDV.app`(또는 해당 arch 디렉터리)만 있는지 확인
- `npm run install:local` / `update:local`이 기존과 동일하게 동작하는지 확인 (언팩 디렉터리만 사용하므로 회귀 없어야 함)

## 리스크 / 미결정 사항
- `.dmg`가 주는 "Applications 폴더로 드래그" UX가 사라지지만, 이 프로젝트는 애초에 스크립트로 설치를 완전히 자동화하고 있어(README:11-49) 실질적 사용성 손실은 없다고 판단됨. 사용자 확인 없이 진행 가능한 수준의 결정.
