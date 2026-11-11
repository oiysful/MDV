# 34. 다음 릴리스(v1.5.0) 전 점검 목록

## 상태
**대기 중(2026-11-11).** Ian이 **2026-11-13 08:05 KST(= 2026-11-12 23:05Z) 이후** 남은 것을 한 번에 확인하고 릴리스까지 간다. 새 세션은 아래 [재개 순서](#재개-순서-2026-11-13-0805-kst-이후)를 위에서부터 따른다.
- 끝난 것: 버전 1.5.0 결정, 보안 감사 96/100, README 제한사항, Electron 44.10.2(PR #63), 인쇄 줄바꿈 수정(PR #64)과 재설치, 릴리스 노트 초안
- 남은 것: marked 쿨다운 뒤 확인, Ian의 PDF 재확인과 확인 문서 마무리, 노트 검토, 릴리스 당일 1~7단계

v1.4.0 이후 develop에는 영어 UI(feat), 보안 수정, marked 18·mermaid 12·Electron 44.10.2 업그레이드, 인쇄 수정이 쌓였다.

## 재개 순서 (2026-11-13 08:05 KST 이후)
1. **시각 확인**: `date -u`가 2026-11-12 23:05Z를 지났는지 본다. 아직이면 Ian에게 말하고 멈춘다.
2. **저장소 상태**: `git fetch && git status --short --branch && git log --oneline -5`. develop이 깨끗하고 origin과 같은지 본다. 앱을 설치한 `72def73` 뒤로 코드 커밋이 들어왔다면 Ian에게 알린다. 그러면 앱을 다시 설치해야 할 수 있다. 문서 커밋만 있으면 괜찮다.
3. **marked 18.2.0 확인**: `npm view marked@18.2.0 dist.integrity deprecated`와 `npm view marked time --json | grep '"18.2.0"'`
   - 기대: integrity 한 줄만 나오고 `deprecated` 줄은 없다. integrity는 `sha512-KaeL+tAbtvI930q7HE2PN5lYXYdT8EiSmxHlN6F3rsfb57wd5mp5W5TLazpdj4inTQBJdgjYwbs40W/0VUGU+Q==`(`package-lock.json`과 같다). 게시 시각은 `2026-11-09T23:05:41.759Z`다.
   - 2026-11-11에 미리 돌려 봤을 때는 셋 다 같았다. 쿨다운이 끝난 뒤 다시 확인해야 한다.
   - 맞으면: `memory-security.md` Accepted Risks의 "2026-11-10 DELIBERATE COOLDOWN BYPASS" 주석에 확인 날짜를 적어 닫는다.
   - **다르면(게시 취소, deprecated, integrity 불일치): 릴리스를 멈추고 Ian에게 보고한다.**
4. **`npm audit` 다시 실행**: 11-10 결과는 high·critical 0, moderate는 빌드 전용 minimatch뿐이었다. 그 사이 새 high·critical이 런타임 의존성에 생겼으면 릴리스 전에 Ian과 정한다. 새 Electron 44.x 패치가 나왔는지(`npm view electron version`)도 알리기만 한다. 올릴지는 Ian이 정한다.
5. **Ian에게 세 가지를 묻는다.** 이미 끝났다고 가정하지 않는다.
   - **PDF 재확인**: 다시 설치한 앱(`72def73` 빌드)에서 [`docs/release-check/manual-check.md`](../release-check/manual-check.md) 5절의 아주 긴 줄을 PDF로 저장하면, 스크롤바 없이 종이 폭에 맞춰 줄바꿈되는가. 확인 문서의 나머지 체크박스(언어 전환 포함)도 다 통과했는가. 1차 확인에서 문제로 보고된 것은 3건뿐이었지만, 전체 통과 여부는 아직 확인하지 않았다.
   - **릴리스 노트 검토**: [34-release-notes-v1.5.0.md](./34-release-notes-v1.5.0.md)
   - **#28 닫기**: `! gh pr close 28 --comment "#60으로 대체"`. 분류기가 막아서 Ian이 직접 실행한다.
6. **릴리스 당일 1~7단계**(아래)를 진행한다. 되돌리기 어려운 지점마다 Ian의 명시적 승인을 받는다.
   - bump PR 머지
   - develop→main 머지
   - **`v1.5.0` 태그 push**: `v*` 태그는 이동·삭제가 막혀 있어 되돌릴 수 없다.
7. **릴리스 뒤 정리**
   - 이 계획을 `done/<날짜>/`로 옮기고 `docs/plans/README.md` 목차를 고친다.
   - 메모리(`mdv-homebrew-distribution` 등)와 `.remember/remember.md`를 갱신한다.
   - 로컬 브랜치 삭제를 Ian에게 제안한다. develop에 머지된 것은 `chore/electron-44.10.2`, `chore/marked-18.2`, `chore/mermaid-12`, `docs/plan-32`, `fix/print-code-wrap`, `fix/split-settle-comments`다. `investigate/known-unverified`는 같은 내용이 develop에 있다. `worktree-agent-a942a1a6edc795fa2`는 옛 main 지점이다. `chore/marked-18`은 #28을 닫은 뒤 지운다.

## 릴리스 전
- [x] **버전 결정**: 1.5.0 (Ian, 2026-11-10)
- [ ] **marked 18.2.0 쿨다운 뒤 확인**(2026-11-12 23:05Z 이후): 재개 순서 3번. 쿨다운은 Ian 결정으로 우회했다(`memory-security.md`).
- [x] **Electron 44.9.3 → 44.10.2**(2026-11-03 공개, 쿨다운 지남): Chromium 152.0.7977.169와 업스트림 백포트, asar 처리 수정이 들어 있다. Ian 결정으로 올렸다. PR #63은 CI(Electron 132/132)와 리뷰 봇을 통과한 뒤 머지됐다(`66f734e`).
- [x] **보안 재점검**: 2026-11-10 전체 감사 결과 **96/100**, 결함 0건(`security-report.md`). 감사 대상은 marked 18 렌더 경로(이스케이프가 렌더러로 옮겨감)와 mermaid 12 strict 모드였고, 둘 다 적대적 입력으로 확인했다. R1은 accepted risk로 기록했다.
- [x] `npm audit`: high·critical 0(2026-11-10 확인). minimatch moderate는 빌드 전용이다. 재개 때 다시 돌린다(재개 순서 4번).
- [ ] **앱 직접 확인**(`install:local`, develop을 체크아웃한 상태에서)
  - 지금 설치본: develop **`72def73`** 빌드(2026-11-10, 인쇄 수정 PR #64 포함). 처음 설치는 `a8cc786`이었다.
  - Claude가 확인한 것(두 빌드 모두):
    - [x] fuse 세 개 Disabled(`npx --no-install @electron/fuses read --app /Applications/MDV.app`)
    - [x] `codesign --verify --deep --strict` 통과
    - [x] asar 안에 marked 18.2.0·mermaid 12.3.0·DOMPurify 3.4.17, Electron 44.10.2가 있다. `72def73` 빌드에는 인쇄 규칙도 있다.
    - [x] 임시 프로필로 숨김 실행: 메인·GPU·유틸리티·렌더러 2개가 떴다
    - 앱 버전 표시는 아직 1.4.0이다. 릴리스 1단계에서 올린다. 덕분에 릴리스 직후 업데이트 배너를 실전으로 확인할 수 있다(7단계).
  - **화면 확인은 Ian이 한다**: [`docs/release-check/manual-check.md`](../release-check/manual-check.md)를 MDV로 연다. 절마다 기대 결과와 체크박스가 있다. 다루는 것은 다음과 같다.
    - 영어/한국어 UI(macOS 앱별 언어)
    - 긴 문서, 표, Alert, 물결 취소선, 코드 블록 복사, 들여쓴 코드, 작업 목록, 프론트매터
    - marked 18의 알려진 한계: R4(`- a⏎      c⏎  e`), 기호로 끝나는 굵게 + 조사
    - mermaid 12: 라이트·다크, 테마 전환, 소스 모드 왕복, 인쇄/PDF
    - KaTeX 펜스, 분할 보기 들어가기·나오기, ⌘U 위치, 목차 강조
  - **Ian 1차 확인(2026-11-10, `a8cc786` 빌드)**: 보고 3건
    - 긴 코드 줄이 PDF에서 스크롤바와 함께 잘린다: 2026-05부터 있던 인쇄 CSS 결함이었다. PR #64(`4751138`)로 고쳤다(인쇄에서만 줄바꿈). `72def73`으로 다시 설치했다. **PDF 재확인은 Ian이 한다(재개 순서 5번).**
    - 두 물결과 한 물결 취소선 사이에 차이가 없다: 정상이다(GFM은 둘을 같은 취소선으로 다룬다). 확인 문서의 문구가 차이를 기대하게 써 있었고, 고쳤다(`f1fe0ef`).
    - 목차 강조가 13→15절에서 따라가지 않고, 끝에서 마지막 항목이 켜지지 않는다: 문서 끝의 짧은 절은 화면 맨 위까지 올라오지 못해 강조될 수 없다(v1.4.0부터 같은 동작, 1~13절은 정상). **Ian 결정: 동작은 그대로 두고 문서만 고친다.**
    - 들여쓴 코드 블록이 들여쓰기 없이 보이는 것은 정상이다(Ian 확인).
- [x] **README·README.ko 알려진 제한사항**: R1·R4·기호로 끝나는 굵게의 GitHub 차이를 모두 적었다(Ian 결정, `fa8f94d`). 영어 README 스크린샷은 계속 보류한다.
- [ ] **릴리스 노트 초안**: [34-release-notes-v1.5.0.md](./34-release-notes-v1.5.0.md)에 써 두었다(2026-11-10, 인쇄 수정 포함). Ian이 검토해야 한다(재개 순서 5번). 릴리스 당일 `gh release edit v1.5.0 --notes-file docs/plans/34-release-notes-v1.5.0.md`로 붙인다. 형식은 v1.4.0을 따랐다(한국어, Upgrade·새 기능·개선·버그 수정·보안·알려진 제한사항). 다룬 내용은 다음과 같다.
  - 영어 UI
  - L1(복사 버튼 위조)·L2(fuse)
  - DOMPurify critical·Electron high
  - TOC·분할 보기 위치 수정, 인쇄 긴 코드 줄
  - marked 18.2.0(최악 입력 30초 → ms)
  - mermaid 12(ELK 배치)
- [x] `claude-review.yml`: v1.4.0 이후 변경 없음. 릴리스해도 리뷰 봇에는 영향이 없다.

## 릴리스 당일 — RELEASING.md 순서 그대로
1. [ ] develop에서 브랜치 → `npm version 1.5.0 --no-git-tag-version` → `chore(release): bump version to 1.5.0` PR → CI 통과 → **Ian 승인 후** develop에 머지
2. [ ] develop → main PR → **Ian 승인 후** 머지
3. [ ] **Ian 승인 후** main 머지 커밋에 태그: `git checkout main && git pull --ff-only && git tag v1.5.0 && git push origin v1.5.0`. 되돌릴 수 없다.
4. [ ] 워크플로가 zip과 `SHA256SUMS`를 만든다(`gh run watch`). **CI에서 처음으로 fuse 변경·ad-hoc 재서명이 돌고, 처음으로 Node 26 빌드가 나온다.** 깨지면 fuse·재서명부터 본다. Node 26은 로컬에서 같은 빌드가 통과했다.
5. [ ] `gh release edit v1.5.0 --notes-file docs/plans/34-release-notes-v1.5.0.md`
6. [ ] 탭 `Casks/mdv.rb`가 1.5.0이고, 그 `sha256`이 게시된 `SHA256SUMS`와 같은지 두 파일을 받아 비교한다.
7. [ ] 확인. 순서가 중요하다.
   - **업데이트 배너(`brew upgrade` 전에)**: 지금 설치본은 1.4.0 라벨이라 배너가 떠야 한다.
     - `~/Library/Application Support/MDV/update-check.json` **파일만** 지운다(`session.json`은 둔다).
     - `open -a /Applications/MDV.app`으로 띄우고 10초 넘게 기다린다.
     - "MDV 1.5.0" 배너가 보이고, `update-check.json`의 `latestVersion`이 1.5.0이면 통과다(메모리 `mdv-update-banner-live-test`).
   - `brew upgrade --cask oiysful/tap/mdv`
   - 그 뒤 `npx --no-install @electron/fuses read --app /Applications/MDV.app`: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` 세 개가 Disabled여야 한다.
   - 앱이 실행되고 버전이 1.5.0인지 본다. 서명 식별자가 `Electron`에서 `com.ian.mdv`로 바뀌어 macOS가 폴더 접근을 한 번 더 물을 수 있다(측정한 적은 없다).
