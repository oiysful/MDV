# 34. 다음 릴리스(v1.5.0 제안) 전 점검 목록

## 상태
**진행 중(2026-11-10).** 버전은 1.5.0으로 정했다. 보안 감사(96/100), README 제한사항, Electron 44.10.2(PR #63)는 끝났다. 남은 것은 다음 셋이다.
- marked 쿨다운 뒤 확인(11-12 23:05Z 이후)
- 앱 화면 확인(Ian, 설치 완료)
- 릴리스 노트 검토(초안 있음)

그다음 릴리스 당일 단계로 넘어간다.
v1.4.0 이후 develop에는 영어 UI(feat), 보안 수정, marked 18·mermaid 12·Electron 44.10.2 업그레이드가 쌓였다.

## 릴리스 전
- [x] **버전 결정**: 1.5.0 (Ian, 2026-11-10)
- [ ] **marked 18.2.0 쿨다운 뒤 확인**(2026-11-12 23:05Z 이후): `npm view marked@18.2.0`이 그대로 게시돼 있고 integrity가 `package-lock.json`과 같은지 본다. 쿨다운은 Ian 결정으로 우회했다(`memory-security.md`).
- [x] **Electron 44.9.3 → 44.10.2**(2026-11-03 공개, 쿨다운 지남): Chromium 152.0.7977.169와 업스트림 백포트, asar 처리 수정이 들어 있다. Ian 결정으로 올렸다. PR #63은 CI(Electron 132/132)와 리뷰 봇을 통과한 뒤 머지됐다(`66f734e`).
- [x] **보안 재점검**: 2026-11-10 전체 감사 결과 **96/100**, 결함 0건(`security-report.md`). 감사 대상은 marked 18 렌더 경로(이스케이프가 렌더러로 옮겨감)와 mermaid 12 strict 모드였고, 둘 다 적대적 입력으로 확인했다. R1은 accepted risk로 기록했다.
- [x] `npm audit`: high·critical 0(2026-11-10 확인). minimatch moderate는 빌드 전용이다.
- [ ] **앱 직접 확인**(`install:local`, develop을 체크아웃한 상태에서). **설치는 끝났다(2026-11-10, develop `a8cc786`).** 확인한 것은 다음과 같다.
  - fuse 세 개 Disabled, `codesign --verify --deep --strict` 통과
  - asar 안 marked 18.2.0·mermaid 12.3.0·DOMPurify 3.4.17, Electron 44.10.2
  - 임시 프로필로 숨김 실행: 메인·GPU·유틸리티·렌더러 2개가 떴다
  - 앱 버전 표시는 아직 1.4.0이다(릴리스 1단계에서 올린다)

  **아래 화면 확인은 Ian이 한다.** 한 번에 확인하려면 [`docs/release-check/manual-check.md`](../release-check/manual-check.md)를 MDV로 연다. 절마다 기대 결과와 체크박스가 있다.

  **Ian 1차 확인(2026-11-10, `install:local` 빌드 `a8cc786`)**: 보고 3건.
  - 긴 코드 줄이 PDF에서 스크롤바와 함께 잘린다: 2026-05부터 있던 인쇄 CSS 결함이었다. PR #64(`4751138`)로 고쳤다(인쇄에서만 줄바꿈). 새 빌드(`72def73`)를 `install:local`로 다시 설치했다(2026-11-10). 앱 안에 인쇄 규칙이 들어 있고, fuse는 Disabled, 서명은 통과, 숨김 실행도 정상이다. **PDF 재확인은 Ian이 한다.**
  - 두 물결과 한 물결 취소선 사이에 차이가 없다: 정상이다(GFM은 둘을 같은 취소선으로 다룬다). 확인 문서의 문구가 차이를 기대하게 써 있었고, 고쳤다(`f1fe0ef`).
  - 목차 강조가 13→15절에서 따라가지 않고, 끝에서 마지막 항목이 켜지지 않는다: 문서 끝의 짧은 절은 화면 맨 위까지 올라오지 못해 강조될 수 없다(v1.4.0부터 같은 동작, 1~13절은 정상). **Ian 결정: 동작은 그대로 두고 문서만 고친다.**
  - 그 밖에, 들여쓴 코드 블록이 들여쓰기 없이 보이는 것은 정상이다(Ian 확인).
  - 영어/한국어 UI(macOS 앱별 언어)
  - 긴 문서, 표, Alert, 물결 취소선, 코드 블럭 복사, 들여쓴 코드, 작업 목록, 프론트매터
  - marked 18의 알려진 한계 확인: R4(`- a⏎      c⏎  e`), 기호로 끝나는 굵게 + 조사
  - mermaid 12: 플로차트·시퀀스·마인드맵을 라이트와 다크에서 보고, 테마를 전환하고, 소스 모드를 왕복하고, 인쇄/PDF
  - KaTeX 펜스, 분할 보기 들어가기·나오기, ⌘U 위치, 목차 강조
  - 로컬 빌드 fuse: `npx --no-install @electron/fuses read --app /Applications/MDV.app`
- [x] **README·README.ko 알려진 제한사항**: R1·R4·기호로 끝나는 굵게의 GitHub 차이를 모두 적었다(Ian 결정, `fa8f94d`). 영어 README 스크린샷은 계속 보류한다.
- [ ] **릴리스 노트 초안**: [34-release-notes-v1.5.0.md](./34-release-notes-v1.5.0.md)에 써 두었다(2026-11-10). Ian이 검토해야 한다. 릴리스 당일 `gh release edit v1.5.0 --notes-file docs/plans/34-release-notes-v1.5.0.md`로 붙인다. 형식은 v1.4.0을 따랐다(한국어, Upgrade·새 기능·개선·버그 수정·보안·알려진 제한사항). 다룬 내용은 다음과 같다.
  - 영어 UI
  - L1(복사 버튼 위조)·L2(fuse)
  - DOMPurify critical·Electron high
  - TOC·분할 보기 위치 수정
  - marked 18.2.0(최악 입력 30초 → ms)
  - mermaid 12(ELK 배치)
- [x] `claude-review.yml`: v1.4.0 이후 변경 없음. 릴리스해도 리뷰 봇에는 영향이 없다.

## 릴리스 당일 — RELEASING.md 순서 그대로
1. [ ] `npm version 1.5.0 --no-git-tag-version` → `chore(release): bump version to 1.5.0` PR → develop
2. [ ] develop → main PR 머지
3. [ ] main 머지 커밋에 `v1.5.0` 태그 push
4. [ ] 워크플로가 zip과 `SHA256SUMS`를 만든다. **CI에서 처음으로 fuse 변경·ad-hoc 재서명이 돌고, 처음으로 Node 26 빌드가 나온다.**
5. [ ] `gh release edit v1.5.0 --notes-file …`
6. [ ] 탭 cask 자동 갱신을 확인한다
7. [ ] `brew upgrade` 뒤 fuse 읽기(세 개 Disabled), 앱 실행, 업데이트 배너 확인
