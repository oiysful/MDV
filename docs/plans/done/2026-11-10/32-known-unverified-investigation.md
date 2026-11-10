# 32. 알려졌지만 확인도 수정도 안 된 네 가지 — 분할 보기 사이드바 전환 둘, CI 둘

## 상태
**조사 완료(2026-11-10). 앱·테스트 코드는 바꾸지 않았다.** Ian 결정에 따라 (a)·(b)의 틀린 주석만 PR #62(`b8e8bdd`)로 고쳤다. 아래 "결정"을 보라. (c)의 실험 제안은 Electron 45로 올릴 때 다시 본다. 아래 수치는 develop `94b6a3f`(Electron 44.9.3, Node 26.13.0,
macOS 로컬, 별도 표시가 없으면 하드웨어 GPU, 기본 창 1280×800)에서 프로브로 잰 것이다. Electron은 Playwright(`tests/electron/helpers/launch.js`)로만
**20회** 띄웠고(직렬), 키 입력 합성·화면 캡처는 쓰지 않았다. `src/`에 넣은 진단 코드는 프로브가 끝난 뒤 `git checkout -- src/`로 되돌렸다.
프로브 코드의 핵심은 맨 아래 "재현 방법"에 옮겨 두었다.

| 항목 | 판정 | 한 줄 요약 |
|---|---|---|
| (a) `transitioncancel`이 새 settle 리스너를 떼어 낸다 | **확인됨** | 빠른 재토글 23회 모두 새 리스너가 옛 전환의 `transitioncancel(width)`을 받고 빠졌다. 그 뒤의 `transitionend(width)`는 앱에 닿지 않았다. 영향은 창 폭에 달려 있다. 기본 1280px에서는 0이고, 1000px에서 보통 속도로 재토글하면 목차 강조가 경계 24곳 중 12곳에서 한 칸 어긋난다. 읽던 위치에는 영향이 없다. |
| (b) 정상 경로 settle 재적용이 실제로 도는가 | **확인됨(의문이 맞다)** | 레이아웃이 바뀌는 경로에서는 스크롤 앵커링이 `scrollTop`을 옮겨 가드가 매번 재적용을 건너뛴다. 레이아웃이 안 바뀌는 경로에서는 돌지만 아무것도 바꾸지 않는다. 잰 모든 정상 경로에서 재적용을 끈 것과 결과가 같았다. |
| (c) Electron 44 CI 전용 ~51s 멈춤 | **판단 불가** | 44.10.x·45.x 릴리스 노트와 Electron 이슈에 관련 수정 기록이 없다. 다만 기록이 없다는 것은 약한 증거다. 실험은 단독으로는 가치가 낮다. Electron 45로 올릴 때 미리 고정한 규칙으로 한 번 하자고 제안한다. |
| (d) #56/#57 CI 탭 복원 테스트의 "스크롤 1회" | **원인 확인됨(재현)** | 테스트가 스스로 쓴 `scrollTop`의 scroll 이벤트가 카운터 리셋 뒤에 배달된 것이다. `buildToc()`가 이전 탭의 `scrollTop`으로 미리 켠 강조가 전제 대기를 앞당겨 만족시켰다. 앱 결함은 아니다. |

## 배경
2026-10-13 PR #56(목차 강조)·#57(분할 보기 읽던 위치)이 "관찰만 하고 확인하지 않은 것"으로 남긴 넷이다. 출발점은 메모리
`mdv-split-sidebar-transition-gotchas`의 1·3·5번, `mdv-electron44-ci-stall`, AGENTS.md NOTES의 Electron 44 항목이다. 판정 원칙은
`mdv-verify-repro-conditions`를 따랐다. 반증할 수 있는 프로브를 먼저 돌리고, 조건을 강제하고, 대조군을 같이 돌렸다.

---

## (a) `transitioncancel`이 새로 붙은 settle 리스너를 떼어 내는가

### 질문
`editor.js#setSplitMode`는 이전 settle 리스너를 동기적으로 떼고(`editor.js:335`) 새 리스너를 `transitionend`·`transitioncancel` 둘 다에
붙인다(`:361-362`). 사이드바 0.25s 전환이 도중에 뒤집히면, 대체된 전환의 `transitioncancel`이 새 리스너에 먼저 도착하는가?
그래서 새 리스너가 스스로 빠지고(`:350`), 마지막 `refreshHeadingOffsets()`와 위치 재적용이 일어나지 않는가? 코드 주석(`:284-291`, `:348-349`)은
"새 호출의 리스너가 정리한다"고 가정한다.

### 관찰(실측)
`src/`에 임시 진단을 넣었다. 리스너마다 세대 번호를 붙이고, 핸들러 맨 앞(필터 전)에서 `event.type`·`target`·`propertyName`·`elapsedTime`·시각을
기록했다. 앱과 독립된 리스너도 `#sidebar`에 따로 붙여 `transition*`을 전부 기록했다. 시나리오는 셋이다. A1은 미리보기→분할 진입 도중 재토글,
A2는 분할 이탈 도중 재진입, A3는 분할로 들어가는 탭에서 전환 도중 미리보기 탭으로 바꾸는 경우로 PR #57의 원래 관찰이다. 각각
**rapid**(도중 재토글), **control**(전환이 끝난 뒤 토글), **counterfactual**(진단 플래그로 cancel을 무시하게 한 rapid)로 돌렸다.
전환 시간은 2s로 늘린 것(`addStyleTag`, 폭이 양 끝에서 20px 이상 떨어졌을 때 재토글)과 원래 0.25s(60ms 뒤 재토글)를 모두 썼다.

| 묶음 | 횟수 | 새 리스너가 받은 것 | 앱에 닿은 `transitionend(width)` | 독립 리스너가 본 `transitionend(width)` |
|---|---|---|---|---|
| rapid | 23(1280px 8, 1000px 15) | 23/23 `transitioncancel(width)` → 스스로 빠짐 | **0/23** | 23/23 |
| control | 12 | cancel 없음 | 12/12 → refresh·재적용 경로 진입 | 12/12 |
| counterfactual(cancel 무시) | 20 | 20/20 cancel 받고 무시 | 20/20 → refresh·가드·재적용 | 20/20 |

예: A1 rapid, 1280px, 2s 전환. 2세대 리스너가 1112.3ms에 붙었다. 1115.9ms에 `transitioncancel(width, elapsedTime 0.318s)`을 받고
빠졌다. 1283.6ms에 뒤집힌 전환의 `transitionend(width, elapsedTime 0.151s)`이 왔지만 받을 앱 리스너가 없었다. cancel은 늘
붙은 뒤 2~7ms 안, 다음 프레임에 도착했다. A3도 23회 안에 들어 있다. 미리보기 탭으로 바꾸는 순간 `setSplitMode(false)`가 붙인 리스너가
같은 식으로 빠진다. 즉 PR #57의 "분할→미리보기 탭 전환에서는 재현되지 않았다"는 설명(추정)도 확인됐다.

**사용자 영향.** 영향은 사이드바 폭이 본문 폭을 바꾸는지에 달려 있다. 본문은 `max-width: 60em`(15px 기준 900px)이다.

| 창 폭 | 미리보기 본문 폭(사이드바 열림/닫힘) | 분할 칸 폭 |
|---|---|---|
| 1280px(기본) | 888 / 900 | 636.25 |
| 1000px | 608 / (닫힘은 재지 않음) | (재지 않음) |

- **1280px**: 모든 rapid 실행에서 캐시된 헤딩 위치와 실제 위치의 차이가 **0px**였다. 경계 스윕(헤딩 경계 ±4px 24곳에서 강조를
  실제 레이아웃과 비교)도 0/24였다. 12px 폭 차이로는 이 문서의 줄바꿈이 바뀌지 않는다.
- **1000px, 0.25s 전환, 60~75ms 뒤 재토글**(사이드바가 200~225px일 때): A1(최종 미리보기)에서 캐시된 위치가 최대 **289px** 낡았고,
  경계 스윕 **12/24**가 틀렸다(3/3회). 예를 들어 scrollTop 558에서 `#section-1`이어야 할 강조가 `#section-2`였다.
  counterfactual은 0px, 0/24(3/3)다.
- **1000px, 2s 전환**(사이드바 259px일 때 재토글): 0px. 본문 629px와 608px에서 헤딩 위치가 같았다(마지막 헤딩 5379 = 5379).
  **PR #57 테스트처럼 전환을 늘리는 방식으로는 이 영향이 드러나지 않는다.** 재토글 시점의 폭이 끝 폭에 너무 가깝기 때문이다.
- A2(최종 분할)에서는 최대 1155px 낡았다. 다만 분할 보기에서는 목차가 숨겨져 있으므로(계획 05) 보이지 않는다.
- **읽던 위치**: rapid와 counterfactual의 결과가 같았다(예: A1 1000px 0.25s에서 이상 위치와의 차이 39/55/55px 대 55/39/55px).
  잃어버린 재적용이 위치를 바꿨을 경우가 없었다는 뜻이고, 그 이유는 (b)다.

**제외한 한 건.** 새로 띄운 앱의 첫 시나리오 한 번에서(A1 rapid, 1280px, 2s) 분할 칸이 6절에서 11절로 밀렸다(1615px).
분할 스크롤 동기화(`setScrollRatio<sync`)가 40ms 동안 `#content`에 다섯 번 써서 3897→7731이 됐다. 같은 절차로 새로 띄운
3회와 나머지 22회에서는 한 번도 나오지 않았다. 창이 앞으로 뜨는 동안의 외부 입력일 수 있지만 확인하지 못했다(추정). (a)의 결론에는 넣지 않았다.

### 추정
- 낡은 위치는 다음 레이아웃 변경(창 크기 변경, 모드 전환, 다음 사이드바 전환 완료)까지 남는다. `refreshHeadingOffsets()`의 호출처를
  코드로 읽은 결과이고, 시간 경과는 재지 않았다.

### 판정
**확인됨.** 메커니즘을 직접 관찰했고, cancel을 무시하는 반사실 실행이 결과를 되돌렸다.

### 남은 불확실성
- 다른 문서(이미지·표·코드가 많은 문서)나 다른 창 폭에서의 크기. 영향은 "재토글 시점 폭과 끝 폭에서 줄바꿈이 다른가"로 정해지므로
  문서마다 다르다.
- 1000px의 A3(0.25s)는 돌리지 않았다.

### 권고
고칠 가치는 낮다. 좁은 창에서 빠르게 두 번 토글한 뒤에만 목차 강조가 한 칸 어긋난다. **다만 주석 `editor.js:284-291`·`:348-349`는
틀렸으므로 고치지 않더라도 주석은 바로잡는 편이 좋다.**
고친다면 두 가지 안이 있다(둘 다 미구현, 판단은 Ian).
1. `transitioncancel` 등록을 뺀다. 앞 리스너는 `:335`에서 이미 동기적으로 떼므로, cancel 분기를 타는 것은 새 리스너가 옛 전환의 cancel을
   받는 경우뿐이었다(23/23). counterfactual 실행이 사실상 이 안이고 20/20 정상이었다. 위험은 cancel 뒤 `transitionend`가 오지 않는
   경우(전환 도중 사이드바가 숨겨지는 경우 등)다. 그러면 리스너가 다음 width 전환까지 남아 refresh를 한 번 더 하고(무해), 가드를 거친 재적용을
   한 번 시도한다.
2. 리스너 대신 실제 전환 객체(`sidebar.getAnimations()`의 width `CSSTransition`)의 `finished`를 기다린다. cancel이 그 전환의
   것인지 구분되므로 정확하지만 코드가 늘어난다.
위치 쪽은 (a)만 고쳐서는 달라지는 것이 없다. (b)와 같은 핸들러이므로 고친다면 함께 다룬다.

---

## (b) 정상 경로의 settle 재적용은 실제로 도는가

### 질문
settle 핸들러의 재적용은 가드(`editor.js:357`)를 통과해야 한다. 같은 탭·같은 모드이고 `pending.scroller.scrollTop === pending.scrollTop`일
때만이다. 전환 중 리플로에 따라 스크롤 앵커링(`overflow-anchor`)이 `scrollTop`을 옮기면 가드가 재적용을 건너뛰는가?
들어가기·나오기 테스트는 재적용이 있든 없든 통과하므로 구분하지 못한다.

### 관찰(실측)
진단 계수기는 첫 적용 전후의 `scrollTop`, settle 이벤트 종류, 가드 절별 결과(+기록값/현재값), 재적용 전후의 `scrollTop`을 기록했다.
네 갈래로 같은 절차를 돌렸다.
- **normal**: 그대로
- **noReapply**: 가드를 통과해도 재적용하지 않음
- **forceReapply**: 가드의 scrollTop 절만 무시
- **anchorNone**: 코드는 그대로 두고 `#scroll-area, #content { overflow-anchor: none }`
사이드바 전환은 원래 0.25s이고, 전환이 끝나기를 기다린 뒤 측정했다. 1280px는 갈래마다 3회, 1000px는 2회다. **같은 조건의 반복은 전부 같은 값이었다.**
"이상 위치와의 차이"는 토글 전 위치(앵커 구간·비율)를 최종 레이아웃의 실제 헤딩 위치에 다시 풀었을 때의 `scrollTop`과 실제 `scrollTop`의 차다.

| 경로 | 창 | 가드 scrollTop 절(기록 → settle 때) | normal: 재적용 / 이상 위치와의 차이 | noReapply | forceReapply | anchorNone |
|---|---|---|---|---|---|---|
| 들어가기 | 1280 | 3897.5 → 3241.5(−656), **불통과** | 안 돎 / **65.5px**(비율 0.617, 목표 0.5) | 65.5px | 3241.5→3176, 0px | 가드 통과(3897.5 그대로), 3897.5→3176, 0px |
| 나오기 | 1280 | 3065 = 3065, 통과 | 돎, 3065→3065(변화 없음) / 0px | 0px | 0px | 0px |
| ⌘U(분할→소스) | 1280 | 7479 = 7479, 통과 | 돎, 7479→7479(변화 없음) / 9절 | 9절 | 9절 | 9절 |
| 들어가기 | 1000 | 6352 → 4120.5(−2231.5), **불통과** | 안 돎 / **223px**(비율 0.824) | 223px | 4120.5→3897.5, 0px | 가드 통과, 6352→3897.5, 0px |
| 나오기 | 1000 | 3065 → 4115(+1050), **불통과** | 안 돎 / **−65.5px**(비율 0.363) | −65.5px | 4115→4180.5, 0px | 가드 통과, 3065→4180.5, 0px |
| ⌘U(분할→소스) | 1000 | 7479 = 7479, 통과 | 돎, 변화 없음 / 9절 | 9절 | 9절 | 9절 |

- settle의 `transitionend(width)`는 60회 모두 앱 리스너에 닿았다(정상 경로에서는 (a)의 cancel이 생기지 않는다).
- **normal 갈래에서 재적용이 `scrollTop`을 바꾼 횟수: 0/15.** 결과는 모든 경로·창 폭에서 noReapply와 같았다.
- `overflow-anchor: none`이면 전환 중 `scrollTop`이 그대로이고(가드 통과), 재적용이 위치를 정확히 맞춘다(0px). 가드를 막는 것이
  스크롤 앵커링이라는 직접 증거다.
- 화면 맨 위 섹션은 모든 갈래에서 같았다(6절·9절). 그래서 섹션 단위로 판정하는 기존 테스트로는 구분할 수 없다는 메모리 5번이 맞다.

### 추정
- 앵커링은 앵커 노드(대개 문단 블록)의 위치를 지킨다. 반면 재적용은 헤딩 구간 안의 비율을 지킨다. 문단이 다시 줄바꿈되면 둘이
  갈라지고, 위 표의 잔차(같은 섹션 안에서 몇 줄)가 그 차이다.

### 판정
**확인됨.** 정상 경로의 재적용은 레이아웃이 바뀌는 경우에는 매번 건너뛰어지고, 바뀌지 않는 경우에만 돈다. 돌 때는 아무것도 바꾸지 않는다.
잰 범위 안에서 이 단계는 사실상 죽은 코드다.

### 남은 불확실성
- 줄바꿈 모드의 ⌘U(소스 레이아웃이 폭에 따라 바뀜)와 이미지가 많은 문서는 재지 않았다.
- 사용자가 0.25s 안에 직접 스크롤하는 경우(가드의 본래 목적)는 재지 않았다.

### 권고
급하지 않다. 잔차가 같은 섹션 안 몇 줄이다(기본 창에서 들어갈 때 65px). 선택지는 셋이다.
1. 그대로 두되, `pendingSplitReadingPosition` 주석(`editor.js:293-296`)을 사실에 맞게 고친다. "앵커링이 위치를 대신 지키고,
   재적용은 앵커링이 일어나지 않을 때만 돈다."
2. 재적용이 실제로 돌게 한다. 하나는 전환 동안만 스크롤 컨테이너에 `overflow-anchor: none`을 거는 것이다. anchorNone 갈래가 0px로
   이 안의 효과를 보여 준다. 그러면 scrollTop 가드가 원래 뜻대로 "사용자가 스크롤했는가"만 잰다. 다른 하나는 scrollTop 비교 대신
   wheel·keydown·pointerdown 같은 사용자 입력을 직접 추적하는 것이다.
3. 재적용 단계를 지운다.
(a)와 같은 핸들러이므로 손댄다면 한 PR로 묶는 것이 맞다. 그리고 재적용을 끈 상태에서 실패하는 테스트(비율 단위 단언)가 먼저 있어야 한다.

---

## (c) Electron 44 CI 전용 ~51s 멈춤

### 질문
CI에서는 `--disable-gpu`로 완화만 했다(PR #39, 계획 28: baseline 8/16 잡 멈춤 대 0/16). 44.9.3 이후 릴리스나 Chromium 쪽에서
macOS 가상 GPU(paravirtual)·호스티드 러너의 프레임 멈춤이 고쳐졌는가? `--disable-gpu`를 빼 보는 실험은 할 가치가 있는가?
(로컬 재현은 과거에 실패했으므로 시도하지 않았다.)

### 관찰
- **릴리스 노트**(`gh release view -R electron/electron`)는 v44.10.0·44.10.1·44.10.2·45.0.0·45.1.0·45.2.0~45.2.3을 GPU·Metal·ANGLE·
  compositor·viz·hang·stall·freeze·virtual·frame으로 훑었다. 관련 항목은 없었다. 있는 것은 다음 셋이다.
  - Chromium 버전 올림: 44.10.0 → 152.0.7977.169, 45.0.0 → 156.0.8078.48, 45.2.2 → 156.0.8078.80
  - 내용이 열거되지 않은 "Backported fixes from upstream ANGLE, Chromium, Dawn, Skia, V8 …"(44.10.1, 44.10.2, 45.2.0, 45.2.3)
  - 무관한 macOS 수정(`Menu.popup()` 등)
- **electron/electron 이슈 검색**("paravirtual", "GPU macOS GitHub Actions hang", "disable-gpu macOS", "GPU process hang",
  "virtual machine GPU"): 맞는 보고가 없다. 걸린 것은 무관한 #52582(Tahoe 종료 시 usleep 루프) 하나다.
- **웹 검색**: 권위 있는 출처는 없다. Parallels 포럼에 Apple Paravirtualized Graphics를 쓰는 macOS 게스트가 멈춘다는 일화가 있다.
  가설과는 맞지만 약하다.
- **선례**(eduardtomas1/inertia#520, 2026-09-29 머지): 같은 증상을 업스트림 수정 없이 테스트 쪽에서 우회했다. 멈춘 GPU 헬퍼를
  죽여 Chromium이 다시 띄우게 한다.
- **러너 이미지가 바뀌었다**: 계획 28 실험(2026-10-08)은 `macos-26-arm64` 20260907.0351.1이었고, 2026-10-27 실행은 20261013.0424.1이다.
  Electron도 실험 당시(44.7.0 이전)에서 44.9.3으로 바뀌었다.
- **덤으로 잰 것((d) 참고)**: `--disable-gpu`는 프레임 박자를 바꾼다. (d)의 경합이 로컬 새 앱의 첫 반복에서 하드웨어 GPU로는 1/5(새로 띄운 앱만 보면 0/4), `--disable-gpu`로는 4/4 재현됐다.

### 판정
**판단 불가.** 고쳐졌다는 기록이 없다. 하지만 Chromium 롤과 업스트림 백포트는 내용이 열거되지 않으므로 "목록에 없음"은 약한 증거다.
러너 이미지 변경도 빈도를 어느 쪽으로든 바꿀 수 있다.

### 권고
**지금 단독으로 실험할 가치는 낮다.**
- 얻는 것: CI가 하드웨어 합성 경로를 탄다. 다만 러너의 가상 GPU는 사용자 GPU와 다르다. 로컬 GPU 실행과 프레임 박자도 비슷해진다.
- 잃을 수 있는 것: 잡 시간이 2~3분에서 4~7분으로 는다. 멈춤이 돌아오면 이제는 "빨강 = 회귀" 규칙 아래에서 회귀로 다뤄야 한다.
- `--disable-gpu`가 GPU 실행에서 숨는 타이밍 경합을 드러내기도 하므로((d)), 이 플래그는 꼭 해롭기만 한 것도 아니다.

**하게 된다면** Electron 45(Chromium 156)로 올리는 PR에 합쳐 한 번, 아래 규칙을 실험 전에 고정해서 한다.
- **설계**: 계획 28과 같다. `include:`로 baseline·disable-gpu 잡을 교대로 배치하고, 시도당 8+8, Draft PR로 연다. "멈춘 잡"은 40초를
  넘은 테스트가 1건 이상인 잡이다.
- **유효성(추가)**: 지금 `[mdv-gpu-status]`는 `MDV_ELECTRON_EXTRA_ARGS`가 있을 때만 찍힌다(`launch.js:140`). 그래서 baseline 잡은 하드웨어
  합성으로 돌았다는 것을 증명할 수 없다. 실험 브랜치에서는 테스트 헬퍼만 고쳐 이 줄이 항상 찍히게 한다. baseline은
  `gpu_compositing: enabled`인 잡만, disable-gpu는 `disabled_software`인 잡만 유효로 센다.
- **판정 규칙**:
  1. 1차(8+8)에서 baseline 멈춘 잡이 2개 이상이면 → 플래그 유지, 종료.
  2. 그렇지 않으면 2차(8+8)를 더 돌린다. 합계 16+16에서:
     - baseline 0/16이고 disable-gpu 0/16 → 플래그 제거 PR. 단 되돌림 조건을 붙인다. 이후 develop·PR CI 20회 안에 ~51s 멈춤
       흔적이 한 번이라도 보이면, 재실행으로 판정하지 말고 플래그를 즉시 되살린다.
     - baseline 1/16 → 유지(결론 보류, 현상 유지).
     - baseline 2/16 이상 → 유지.
     - disable-gpu에서 유효 잡 멈춤이 1개 이상 → 전제("하드웨어 가속 경로")가 깨진 것이다. 유지하고 따로 조사한다.
  - 근거: 계획 28의 비율(8/16)이 그대로라면 baseline ≤1/16이 나올 확률은 17/65536 ≈ 2.6×10⁻⁴이다. 반대로 0/16이어도 실제 잡당
    비율은 최대 약 17%(95% 상한)까지 남는다. 그래서 되돌림 조건이 필요하다.

---

## (d) #56/#57 CI에서 탭 복원 테스트가 "스크롤 1회"로 실패한 건

### 질문
`links-and-toc.test.js`의 "switching back to a tab keeps a single TOC highlight when no scroll follows the restore"(`:659`)가
#57 CI(run 38357796986, `c763176`)에서 전제 조건 "스크롤 0회"로 실패했다. 강조는 올바른 `#section-3`, scrollTop 1305, `scrollArea: 1`이었다.
그 스크롤 한 번은 어디서 왔는가? 지금은 `t.diagnostic`으로 보고만 한다(`4c0a2ea`).

### 관찰 — CI 기록
`ci-electron.yml` 실행 20회(563d70b, 2026-10-13 ~ e997355, 2026-10-27)의 진단 줄을 모았다.
- 20회 모두 강조는 `["#section-3"]`, scrollTop 1305, `content: 0`이었다.
- `scrollArea: 1`은 3회다: 38357796986(`c763176`, 단언하던 시절이라 빨강), 38359313154(`9ea8cac`), 38360679030(`869f9af`). 나머지 17회는 0이다.
- 강조 재계산이 들어간 코드(b557dc0 이후)는 20회 중 19회다. 그 전 코드인 563d70b 1회는 0이었다.
- 세 번이 모두 #57 브랜치에 있지만, 3/10 대 0/10은 우연으로 충분히 설명되는 차이(p≈0.2)다. 머지 직후 develop 실행도 이 경로의 코드가 같다.
  그래서 브랜치에 의미를 두지 않는다.

### 관찰 — 로컬 재현
테스트 절차를 그대로 복제하고 기록만 덧붙였다. 기록 대상은 `#scroll-area` scroll 이벤트(시각·scrollTop), `scrollTop` setter 훅(호출 스택),
목차 강조 변화(MutationObserver), 탭 클릭, 그리고 대기 술어 안의 통과 시각이다. 대기를 늘리는 왕복은 추가하지 않았다.

**자연 재현(새로 띄운 앱, 첫 반복).** 시각은 탭 A 생성 기준이다.
```
+508.0  set scroll-area 976→0      createTab (workspace.js:420)   ← 탭 B 렌더 직후 리셋, scroll 이벤트는 다음 프레임 대기
+508.7  pred-title 통과
+512.2  set scroll-area 0→976      테스트의 쓰기 (links-and-toc.test.js:680)
+513.1  pred-section3 통과          ← scroll 이벤트가 한 번도 배달되지 않았는데 통과
+514.4  reset                      (resetScrollCounts, :683)
+652.0  scroll scroll-area top 976  ← 카운트됨. 첫 프레임이 리셋 뒤 138ms에 왔다
+670.2  tab-click
+791.5  set scroll-area 976→976    restoreTabState rAF (workspace.js:201), changed: false
```
결과는 `scrollArea: 1`, scrollTop 976, 강조 `#section-3`로 CI의 모양과 같다. 같은 앱에서 이어 돌린 5회는 리셋 직후 첫 프레임이 1ms 안에
와서 0이었다.

| 조건 | 결과(`scrollArea` 카운트 1의 비율) |
|---|---|
| 자연, 하드웨어 GPU, 새 앱의 첫 반복 | 1/5 |
| 자연, `--disable-gpu`(CI와 같음), 새 앱 | **4/4**. 카운트된 이벤트는 매번 리셋 뒤·탭 클릭 전이고, 복원 쓰기는 `changed: false` |
| 강제: 쓰기와 리셋을 한 `evaluate` 안에서(사이에 프레임 없음) | **3/3**(scrollTop 976, 강조 정상, CI와 같은 모양) |
| 대조: 쓰기 → 2프레임 → 리셋 | **0/3** |
| 시도했지만 강제에 실패: 창을 숨겨 프레임 정지 | 숨긴 창도 scroll 이벤트를 곧바로 배달했다. 강제 수단으로 쓸 수 없음 |

### 원인
1. `createTab`은 `render()`(`workspace.js:414`)를 먼저 하고 `scrollTop = 0`(`:420`)을 나중에 한다. `render()` 안의 `buildToc()`는 b557dc0
   이후 강조를 바로 다시 계산하는데(`markdown.js:842`), 이때 `#scroll-area`는 아직 탭 A의 위치(976)에 있다. 두 문서의 레이아웃이
   같으므로 탭 B의 목차는 `#section-3`을 켠다. 그 직후 같은 작업 안에서 0으로 리셋되고, 그 scroll 이벤트는 다음 렌더링 프레임에 배달된다.
2. 그 프레임이 오기 전에 테스트가 다음을 모두 끝낸다.
   - 제목 대기를 통과한다.
   - 976을 쓴다(0→976).
   - `#section-3` 대기(`:681`)를 통과한다. 1번의 **낡은 강조**가 이미 켜져 있어서 기다리지 않는다.
   - 카운터를 리셋한다(`:683`).
3. 프레임이 오면 0과 976 두 번의 변화가 scroll 이벤트 하나로 배달되고(최종 scrollTop은 변하지 않음), 리셋 뒤라서 카운트된다.

경합 조건은 "탭 B 렌더 뒤 첫 프레임이 테스트의 왕복 네다섯 번보다 늦다"는 것이다. `--disable-gpu`(소프트웨어 합성)와 새 앱의 첫 렌더에서
프레임이 늦다.

### 기각한 후보
- **복원 쪽 쓰기**(`restoreTabState` rAF가 다른 값을 씀): 관찰한 모든 실행에서 `changed: false`였고, 카운트된 이벤트는 탭 클릭보다 먼저 왔다.
- **innerHTML 교체 때의 스크롤 앵커링 / 포커스 이동의 스크롤 / Playwright 클릭의 `scrollIntoViewIfNeeded`**: 탭 클릭 뒤 scroll 이벤트는
  모든 실행에서 0이었다. 클릭 대상(`#tab-list`)은 `#scroll-area` 밖에 있고, `renderTabBar`의 `focus()`도 탭에만 간다.
- **부드러운 스크롤**: `#scroll-area`에 `scroll-behavior`가 없다(`index.html:625`).

### 추정
- 탭 B의 낡은 `#section-3` 강조는 사용자 눈에 보이지 않는 것으로 본다. 첫 프레임의 scroll 이벤트 → 같은 프레임의 rAF 재계산이 페인트 전에
  강조를 고친다. 다만 페인트 여부는 재지 않았다.
- 로컬 `--disable-gpu`는 4/4인데 CI는 3/20인 차이는 설명하지 못했다(러너의 프레임 박자 차이로 추정).

### 판정
**원인 확인됨(재현).** 테스트 대기 설계의 경합이고 앱 결함이 아니다. 강조 단언은 영향을 받지 않는다.

### 권고
- 앱은 고치지 않아도 된다. 지금 테스트는 보고만 하므로 CI에 영향도 없다.
- 진단 수치에 뜻을 두고 싶다면 테스트만 고친다. `:680`의 쓰기와 `:683`의 리셋 사이에 `waitFrames(page, 2)`를 넣는다(대조군 0/3).
  또는 탭 B를 연 뒤 제목 항목이 강조되기를 먼저 기다린다. 그러면 `:681`이 진짜 scroll 이벤트를 기다리게 된다.
- (선택, 미측정) `createTab`에서 0 리셋을 `render()` 앞으로 옮기면 `buildToc()`가 이전 탭의 위치로 강조를 켜는 순간이 없어진다.
  `:415-419` 주석이 "렌더 뒤, 높이가 반영된 뒤"를 이유로 들지만, 0은 높이와 상관없이 유효한 값이다. 바꾸려면 Ian 판단이 필요하다.

---

## 결정 (Ian, 2026-11-10)
- (a)·(b): **틀린 주석만 고친다**(PR #62, 동작 변경 없음). 리스너·`overflow-anchor` 수정은 하지 않는다.
- (c): 결정 없음. 실험은 Electron 45 PR에 묶는 제안으로 남는다.
- (d): 앱은 그대로 둔다. 테스트 쪽 `waitFrames` 보강은 하지 않았다(진단만 보고하는 테스트라 CI에 영향 없음).

## 후속(이 문서 밖)
- (완료, 2026-11-10) 메모리 `mdv-split-sidebar-transition-gotchas` 1번(추정 → 확인)과 3번·5번(원인·실측)을 이 문서로 갱신했다.
- (완료, 2026-11-10, `edc15d5`) AGENTS.md NOTES의 Electron 44 항목에 (c)의 조사 결과와 `[mdv-gpu-status]` baseline 유효성 공백을 덧붙였다.
- (a)·(b)를 고치기로 하면 한 PR로 묶는다. 순서는 다음과 같다. 1000px·0.25s·60ms 재토글의 경계 스윕 테스트(지금 코드에서 12/24 실패)와
  비율 단위 위치 단언(지금 코드에서 들어갈 때 65.5px)을 먼저 빨강으로 확인하고, 그다음 수정한다.

## 재현 방법
프로브는 scratchpad에 두었고 커밋하지 않았다. 아래는 다시 만들 때 필요한 핵심이다.

**환경**
```sh
git switch -c <branch> origin/develop          # main은 낡았다
ln -s /Users/ian/projects/ian/MDV/node_modules ./node_modules   # 커밋 금지(git add -A 금지)
node probe-d.js natural 1                      # 프로브는 worktree의 helpers를 절대 경로로 require한다
MDV_ELECTRON_EXTRA_ARGS=--disable-gpu node probe-d.js natural 1
node probe-d.js onecall,onecallctl 3
node probe-ab.js a 2 1000                      # (a), 창 폭 1000 (BrowserWindow.setSize)
node probe-ab.js b 3                           # (b), 기본 1280
```
macOS에는 `timeout`이 없으므로 프로브 안에 `setTimeout(() => process.exit(3), ms).unref()`를 둔다. 반복 사이에는 탭을 DOM click으로
모두 닫아 `#empty`로 되돌린다(`.file-tab-close`).

**(d) 페이지 안 기록(`src/` 변경 없음)**
```js
const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
const sa = document.getElementById('scroll-area')
sa.addEventListener('scroll', () => log({ ev: 'scroll', top: desc.get.call(sa) }))
Object.defineProperty(sa, 'scrollTop', { configurable: true, get() { return desc.get.call(this) },
  set(v) { const before = desc.get.call(this); desc.set.call(this, v)
    log({ ev: 'set', v, before, after: desc.get.call(this), who: new Error().stack.split('\n').slice(2, 5).join(' < ') }) } })
new MutationObserver(() => { /* #toc-list a.active의 href가 바뀔 때만 기록 */ })
  .observe(document.getElementById('toc-list'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
document.getElementById('tab-list').addEventListener('click', () => log({ ev: 'tab-click' }), true)
// 대기 술어 안에서 통과 시각을 기록한다(왕복을 더하지 않으려고):
await page.waitForFunction(() => { const ok = /* 원래 조건 */; if (ok) log({ ev: 'pred-section3' }); return ok })
// 강제(onecall): 쓰기와 리셋을 한 작업에서
await page.evaluate(top => { sa.scrollTop = top; window.__mdvScrollCounts = { scrollArea: 0, content: 0 } }, parkedTop)
// 대조(onecallctl): 쓰기 → waitFrames(page, 2) → resetScrollCounts(page)
```
나머지 절차는 `links-and-toc.test.js:659-697`과 같다(`resetScrollCounts`·`readTocHighlight`·`parkBetweenHeadings`를 그대로 복제).

**(a)·(b) 임시 `src/` 진단(끝나면 `git checkout -- src/`)** — `editor.js#setSplitMode`의 리스너 부분
```js
const gen = ++__P.gen                                   // __P = window.__mdvProbe = { log: [], gen: 0 }
const onSidebarTransitionSettled = event => {
  __plog('settle-event', { gen, type: event.type, target: event.target.id || event.target.tagName, prop: event.propertyName, elapsed: event.elapsedTime })
  if (event.target !== sidebarEl || event.propertyName !== 'width') return
  if (event.type !== 'transitionend' && window.__mdvProbeCancelKeepsListener) return   // counterfactual
  /* 원래 removeEventListener 두 줄 */
  if (event.type !== 'transitionend') { __plog('settle-cancel-detached', { gen }); return }
  markdownController?.refreshHeadingOffsets()
  const pending = pendingSplitReadingPosition; pendingSplitReadingPosition = null
  const g = pending ? { tab: pending.tab === getActiveTab(), source: pending.sourceMode === sourceMode, split: pending.splitMode === splitMode,
    scroll: pending.scroller.scrollTop === pending.scrollTop, recorded: pending.scrollTop, now: pending.scroller.scrollTop } : {}
  __plog('settle-guard', { gen, pending: Boolean(pending), ...g })
  const pass = Boolean(pending && g.tab && g.source && g.split && g.scroll)
  const force = Boolean(pending && g.tab && g.source && g.split && !g.scroll && window.__mdvProbeForceReapply)
  if ((pass || force) && !window.__mdvProbeNoReapply) {
    const before = pending.scroller.scrollTop; applyToggleReadingPosition(pending.captured)
    __plog('settle-reapply', { gen, forced: force, before, after: pending.scroller.scrollTop })
  }
}
```
그 밖에 다음을 넣었다.
- `applySplitReadingPosition`: 첫 적용 전후의 `scrollTop`을 기록
- `cancelPendingSidebarTransitionListener?.()` 앞: 떼는 세대를 기록
- `markdown.js`: `window.__mdvProbeCachedTops = () => cachedHeadings.map(h => ({ id: h.id, top: h.top, el: Boolean(h.el) }))`,
  `refreshHeadingOffsets` 호출 때 사이드바 폭·본문 폭·마지막 헤딩 위치를 기록

**(a)·(b) 페이지 쪽**
- 독립 리스너: `#sidebar`에 `transitionrun/start/end/cancel`을 붙이고 `e.target === sidebar`인 것만 기록
- 전환 늘리기: `<style>#sidebar { transition-duration: 2000ms !important; }</style>`
- 도중 재토글: `waitForFunction`으로 사이드바 폭이 `min(열림, 닫힘) + 20`과 `max − 20` 사이에 들어온 뒤 다시 `toggleSplitView`. 0.25s 전환에서는 `waitForTimeout(60)`
- 끝 대기: `#sidebar.getAnimations().length === 0` 후 4프레임
- 낡음: `__mdvProbeCachedTops()`와 실제 `offsetTop − scrollArea.offsetTop`의 최대 차
- 경계 스윕: 헤딩 i마다 `scrollTop = top(i) − 24 ± 4`로 두고 3프레임 뒤 `a.active`와 실제 레이아웃 기대값 비교(24곳)
- 이상 위치: 토글 전 `(구간 index, 비율)`을 최종 레이아웃의 앵커(`[0, 헤딩 위치…, maxScroll]`)에 다시 풀어 실제 `scrollTop`과의 차
- anchorNone: `<style>#scroll-area, #content { overflow-anchor: none !important; }</style>`
- ⌘U 경로는 PR #57 테스트처럼 짧은 줄 문서를 쓰고 `emitRendererCommand(..., 'toggleSource')`로 실행(키 입력 금지)

**(c)**
```sh
gh release view v44.10.0 -R electron/electron --json body --jq .body   # 44.10.0~44.10.2, 45.0.0~45.2.3 각각
gh search issues "paravirtual" -R electron/electron
gh run view --job <job-id> --log | grep -m3 -E "Image:|Version:"        # 러너 이미지 버전
```

## 출처
- PR #56(`563d70b`·`b557dc0`·`0adc118`·`4c0a2ea`), PR #57(`d926b6a` … `869f9af`) 본문
- CI(`ci-electron.yml`): 38351151916, 38351678411, 38352110274, 38354789869, 38355621355, 38356068343, 38356722916, 38357134498,
  **38357796986**, 38358763131, 38358799211, **38359313154**, 38359803431, **38360679030**, 38362252406, 38362503859, 40429067618,
  40431986875, 40432217754, 40432682708(굵은 것이 `scrollArea: 1`). 계획 28 실험 run 37730245504(러너 이미지 확인)
- 코드: `src/renderer/editor.js:284-297, 314-368, 662-669`, `src/renderer/markdown.js:804-843, 1038-1061`,
  `src/renderer/workspace.js:172-204, 407-421`, `src/renderer/index.html:373-385, 625-635`,
  `tests/electron/links-and-toc.test.js:659-697`, `tests/electron/helpers/launch.js:106-144`, `.github/workflows/ci-electron.yml:58, 120-121`
- Electron 릴리스 노트: https://github.com/electron/electron/releases/tag/v44.10.0 , …/v44.10.1 , …/v44.10.2 , …/v45.0.0 , …/v45.1.0 ,
  …/v45.2.0 , …/v45.2.1 , …/v45.2.2 , …/v45.2.3
- 선례: https://github.com/eduardtomas1/inertia/pull/520
- 웹 검색(약한 정황): Parallels 포럼의 Apple Paravirtualized Graphics 게스트 멈춤 글 https://forum.parallels.com/posts/905544/
- 메모리: `mdv-split-sidebar-transition-gotchas`, `mdv-electron44-ci-stall`, `mdv-worktree-electron-test-gotchas`, `mdv-verify-repro-conditions`
- 이전 계획: [28](../2026-10-12/28-pre-release-1.4.0.md)(멈춤 실험 설계·판정 규칙의 원형), 05(분할 보기에서 사이드바 강제 숨김)
