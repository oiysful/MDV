# 03. 가이드 모달에 포커스 트랩·ESC 없음

## 문제

`#default-app-guide`와 `#welcome-guide`는 모달처럼 **보이지만** 모달 의미론이 전혀 없다.

```bash
$ grep -cE 'role="dialog"|aria-modal|focus\(\)' src/renderer/index.html src/renderer/onboarding.js
src/renderer/index.html:0
src/renderer/onboarding.js:0
```

구체적으로:

- **ESC로 닫히지 않는다.** 전역 ESC 핸들러(`src/renderer/app-runtime.js:348-349`)는 검색과 컨텍스트 메뉴만 닫는다.
- **포커스가 안으로 이동하지 않는다.** `onboarding.js`는 `.show` 클래스만 붙인다. 키보드 사용자는 모달이 떴는지도 모른다.
- **포커스 트랩이 없다.** Tab을 누르면 뒤에 있는 툴바/사이드바로 포커스가 빠져나간다.
- `role="dialog"` / `aria-modal="true"` 없음 → 스크린리더가 모달로 인식하지 못한다.
- `#default-app-guide`는 **확인 버튼을 클릭하는 것 말고는 닫을 방법이 없다.**

덤으로: `#toast`(`index.html:1256` 부근)에 `role="status"` / `aria-live`가 없어 "저장됨", "복사됨", "PDF 저장됨"이 스크린리더에 **전혀 읽히지 않는다.** 속성 두 개면 끝난다.

## 왜 중요한가

접근성 문제이면서 동시에 일반 사용성 문제다. 모달이 떴을 때 ESC를 누르는 건 보편적인 기대인데, 지금은 마우스로 정확한 버튼을 눌러야만 빠져나올 수 있다.

## 접근

작고 재사용 가능한 모달 헬퍼를 하나 만들어 두 가이드에 적용한다. 새 프레임워크 없이, 기존 `onboarding.js` 컨트롤러 안에 둔다.

1. **마크업** (`index.html`): 두 가이드에 `role="dialog"`, `aria-modal="true"`, `aria-labelledby="<제목 id>"` 추가.

2. **열 때** (`onboarding.js`):
   - 직전 포커스 요소를 저장 (`document.activeElement`).
   - 모달 안 첫 번째 포커스 가능 요소로 `focus()`.

3. **포커스 트랩**: 모달에 `keydown` 리스너를 달아 `Tab`/`Shift+Tab`이 경계를 넘으면 반대편 끝으로 순환시킨다. 포커스 가능 요소는 표준 셀렉터로 수집:
   ```js
   'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
   ```

4. **닫을 때**: `.show` 제거 + **저장해둔 요소로 포커스 복귀**. 이걸 빠뜨리면 포커스가 `<body>`로 떨어져서 키보드 사용자가 길을 잃는다.

5. **ESC**: 전역 핸들러(`app-runtime.js:348`)에 가이드 닫기를 추가한다. 단, **우선순위**를 정해야 한다 — 검색이 열린 상태에서 가이드가 떠 있으면 ESC가 뭘 닫아야 하는가? 가장 위에 있는 것부터 닫는다: 가이드 → 검색 → 컨텍스트 메뉴. 현재 코드는 `if` 두 줄이 나란히 있어 **둘 다 실행된다.** 이걸 `else if` 체인으로 바꾼다.

6. **토스트** (`index.html`): `role="status" aria-live="polite"` 추가. 한 줄.

## 파일

- `src/renderer/index.html` — 가이드 dialog 속성, 토스트 aria
- `src/renderer/onboarding.js` — 모달 열기/닫기/포커스 트랩 헬퍼
- `src/renderer/app-runtime.js:348-349` — ESC 우선순위를 `else if` 체인으로

## 리스크

낮다. 단, `#welcome-guide`는 사실 진짜 모달이 아니라 우측 상단 카드다(`index.html:740`). **여기에 포커스 트랩을 걸면 안 된다** — 사용자가 무시하고 계속 작업할 수 있어야 하는 비차단 안내다. 트랩은 화면 중앙에 뜨는 차단형 `#default-app-guide`에만 적용한다. ESC 닫기는 둘 다 해준다.

이 구분을 놓치면 "안내 카드 때문에 앱이 잠기는" 더 나쁜 버그를 만든다.

## 함께 묶을 만한 것: 탭·탐색기가 키보드로 도달 불가

`docs/analysis-2026-07-02-supplement.md`가 "모달 포커스 트랩과 함께 묶어 처리할 만하다"고 명시한 항목이다.

- **파일 탭**은 `<div>` + click 핸들러다(`workspace.js`의 탭 렌더링). `tabindex`도 `role="tab"`도 없다. 키보드로 탭에 포커스하거나 닫을 수 없다(⌘W / ⌘⇧[ ]로만 가능).
- **탐색기 행**도 마찬가지로 `<div>` + click이다(`explorer.js:87-91`). 즉 **키보드만 쓰는 사용자는 탐색기에서 파일을 열 수 없다.** 모달 문제보다 이쪽이 더 치명적이다.

방향: 탭 바에 `role="tablist"` / `role="tab"` + `tabindex` + 좌우 화살표 네비게이션, 탐색기 트리에 `role="tree"` / `role="treeitem"` + 상하 화살표 + Enter로 열기.

이 문서의 범위(모달)보다 크므로 **별도 작업으로 떼는 걸 권한다.** 다만 포커스 관리 유틸(포커스 가능 요소 수집 등)을 여기서 만들면 그대로 재사용된다.

## 검증

- e2e: `#default-app-guide`를 띄운 뒤 → 포커스가 모달 안에 있는지 → Tab을 요소 수보다 많이 눌러도 `document.activeElement`가 모달 밖으로 안 나가는지 → ESC로 닫히는지 → 포커스가 원래 요소로 돌아오는지.
- e2e: `#welcome-guide`가 떠 있어도 툴바 버튼에 Tab으로 도달 가능한지(트랩 없음 확인).
- 수동: VoiceOver로 토스트가 읽히는지.
