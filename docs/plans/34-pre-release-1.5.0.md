# 34. 다음 릴리스(v1.5.0 제안) 전 점검 목록

## 상태
**점검 목록만 만들었다(2026-11-10). 아직 아무 단계도 시작하지 않았다.** 버전 번호와 선택 항목은 Ian이 정한다.
v1.4.0 이후 develop에 커밋 62개(문서 제외 약 25개)가 쌓였다. 영어 UI(feat)가 들어 있어 **1.5.0**을 제안한다.

## 릴리스 전
- [x] **버전 결정**: 1.5.0 (Ian, 2026-11-10)
- [ ] **marked 18.2.0 쿨다운 뒤 확인**(2026-11-12 23:05Z 이후): `npm view marked@18.2.0`이 그대로 게시돼 있고 integrity가 `package-lock.json`과 같은지 본다. 쿨다운은 Ian 결정으로 우회했다(`memory-security.md`).
- [ ] **Electron 44.9.3 → 44.10.2** — Ian 결정으로 올린다. PR #63은 CI(Electron 132/132)와 리뷰 봇을 통과했고 머지를 기다린다.(2026-11-03, 쿨다운 지남): Chromium 152.0.7977.169와 내용이 열거되지 않은 업스트림 백포트다. 계획 28처럼 릴리스 전에 패치를 올릴지 정한다.
- [x] **보안 재점검**: 2026-11-10 전체 감사 **96/100**, 결함 0건(`security-report.md`). R1은 accepted risk로 기록했다. 마지막 전체 감사는 2026-10-13(92/100)이었다. 그 뒤로 렌더 경로가 marked 18(이스케이프가 렌더러로 옮겨감)과 mermaid 12(ELK)로 바뀌었다. 계획 28처럼 `/security-audit` 또는 v1.4.0..develop 범위의 `/security-scan`을 돌린다.
- [x] `npm audit`: high·critical 0(2026-11-10 확인). minimatch moderate는 빌드 전용이다.
- [ ] **앱 직접 확인**(`install:local`, develop을 체크아웃한 상태에서):
  - 영어/한국어 UI(macOS 앱별 언어)
  - 긴 문서, 표, Alert, 물결 취소선, 코드 블럭 복사, 들여쓴 코드, 작업 목록, 프론트매터
  - marked 18의 알려진 한계 확인: R4(`- a⏎      c⏎  e`), 기호로 끝나는 굵게 + 조사
  - mermaid 12: 플로차트·시퀀스·마인드맵을 라이트와 다크에서 보고, 테마를 전환하고, 소스 모드를 왕복하고, 인쇄/PDF
  - KaTeX 펜스, 분할 보기 들어가기·나오기, ⌘U 위치, 목차 강조
  - 로컬 빌드 fuse: `npx --no-install @electron/fuses read --app /Applications/MDV.app`
- [x] **README·README.ko 알려진 제한사항**: R1·R4·기호로 끝나는 굵게의 GitHub 차이를 모두 적었다(Ian 결정, `fa8f94d`). 영어 README 스크린샷은 계속 보류한다.
- [ ] **릴리스 노트 초안**: v1.4.0 형식(한국어, Upgrade·새 기능·개선·버그 수정·보안)을 따른다. 넣을 것은 다음과 같다.
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
