# 07. 사용성 로드맵 후속 갭 조사 (분할뷰 리사이즈 / 클립보드 무음 실패 / 빈 상태 힌트 텍스트)

## 상태
**A, B, C, D 전부 완료** (2026-08-05). A(분할뷰 리사이즈 구분선)는 2026-08-04 `/team`에서 `#split-divider` 마크업/CSS/드래그 핸들러(`app-shell.js`, `editor.js`)로 구현 완료. B(검색)는 최초 조사에서 "이미 해결되어 조치 불필요"로 잘못 결론 냈다가, 같은 날 Ian의 직접 보고로 정정 후 [`../2026-08-04/08-search-highlight-and-ime-fixes.md`](../2026-08-04/08-search-highlight-and-ime-fixes.md)에서 별도로 완료. C(클립보드 무음 실패)와 D(빈 탐색기 힌트 문구 불일치)는 2026-08-05에 `/team` 병렬 워커로 구현·테스트·검증 완료 — 아래 "적용된 수정" 절 참고.

삭제된 로컬 스크래치 `.sisyphus/plans/usability-feature-roadmap.md`(2026-07-13 SHIPPED, `AGENTS.md:124`에 따라 추적 대상 문서가 아니었음)가 "Known gaps left behind"로 남겨둔 4건을 코드 조사로 재검증한 결과다.

## 문제
2026-07-13 사용성 개선 구현 당시 부산물로 남긴 갭 4건이 그 뒤로도 방치되어 있었는지 재조사가 필요했다.

## 근거 / 원인 (findings)

### A. 분할뷰에 리사이즈 가능한 구분선이 없음
- `src/renderer/index.html:619-624`:
  ```css
  #scroll-area.split-mode {
    display: grid;
    grid-template-columns: minmax(300px, 1fr) minmax(320px, 1fr);
    gap: 1px;
    ...
  }
  ```
- 두 패널 폭이 고정 `1fr`/`1fr` 비율(각 300px/320px 최소값)이며, 드래그로 폭을 조절하는 구분선(divider/splitter) 관련 코드가 `src/renderer/*.js` 전체에 없다(grep 결과 0건). 사용자가 소스와 미리보기 중 한쪽을 더 넓게 보고 싶어도 방법이 없다.

### B. 검색 하드 비활성 — 정정: 라우팅은 고쳐져 있었으나 하이라이팅이 별도로 깨져 있었음
- 로드맵 작성 시점(2026-07-13)엔 `app-runtime.js:254-256`이 원인으로 지목됐으나, 이 문서를 처음 쓸 때(2026-08-04) 확인한 `src/renderer/app-runtime.js:283-286`의 `toggleSearch()`는 `editor.getSourceMode() || editor.getSplitMode()`일 때 `target: 'editor'`로 `searchController.toggleSearch()`를 정상적으로 호출하고 있었다. **이 라우팅 자체는 실제로 커밋 `fb2284d`(2026-07-20 배치)에서 고쳐진 것이 맞다.**
- 하지만 같은 날 Ian이 "편집모드에서 검색 하이라이팅이 여전히 안 된다"고 직접 보고해, "코드 변경 불필요"라는 이 문서의 원래 결론이 틀렸음이 드러났다. 라우팅은 맞았지만 그 경로로 들어간 뒤 매치를 실제로 시각화하는 `search.js`의 `advanceEditorMatch`가 포커스를 에디터로 옮겼다가 같은 호출 안에서 즉시 검색창으로 되돌려, 브라우저가 선택 하이라이트를 페인트할 기회 자체가 없었다 — 별개의, 더 미묘한 버그였다.
- 근본 원인 분석과 수정은 [`../2026-08-04/08-search-highlight-and-ime-fixes.md`](../2026-08-04/08-search-highlight-and-ime-fixes.md)에 기록했다(완료). **교훈**: "라우팅이 맞다"는 "최종 시각적 결과가 맞다"를 보장하지 않는다 — 코드 감사만으로 UI 버그의 부재를 단정하지 말 것.

### C. `copyAll`/`copyCode`의 클립보드 쓰기 실패가 무음
- `src/renderer/app-runtime.js:273-280`(`copyAll`)과 `:313-322`(`copyCode`) 모두 `await navigator.clipboard.writeText(...)`에 `try/catch`나 `.catch()`가 없다.
- 클립보드 접근이 거부되는 경우(OS 권한 팝업 거부, 포커스 상실 등 브라우저 표준 실패 조건)는 `writeText`가 reject하는 프라미스를 반환하는데, 이 경우 함수가 그 지점에서 멈춰 `showToast()` 호출까지 도달하지 못한다. 사용자에게는 버튼을 눌렀는데 "복사됨" 토스트도, 에러 표시도 없이 아무 반응이 없는 것처럼 보인다.

### D. 빈 탐색기 힌트가 "+" 버튼을 가리키지만 실제 버튼은 "열기"로 렌더링됨
- `src/renderer/explorer.js:2`: `EXPLORER_EMPTY_HTML = '<div class="tree-hint">위의 <strong>+</strong> 버튼으로<br>폴더를 열어 탐색하세요.</div>'`
- `src/renderer/index.html:1190-1191`: 실제 버튼은 `title="열기"`, `<span class="btn-add-label">열기</span>` — 아이콘 옆에 "열기" 텍스트 라벨이 붙는 형태로 이미 바뀌어 있고 "+" 심볼만 단독으로 노출되지 않는다.
- 탐색기가 비어 있을 때 힌트 문구가 실제 UI와 어긋나 사용자가 버튼을 찾지 못할 수 있다.

## 제안 방안
- **A (분할뷰 리사이즈)**: `#scroll-area.split-mode` 사이에 드래그 가능한 구분선 엘리먼트를 추가하고, `mousedown`/`mousemove`/`mouseup`으로 `grid-template-columns` 값을 갱신. 폭 비율은 세션 상태(`workspace.js`)에 저장해 탭 전환/재시작 후에도 유지할지 여부는 범위 확정이 필요(아래 리스크 참고).
- **B (검색)**: 조치 없음. 실사용 회귀 확인만.
- **C (클립보드)**: `copyAll`/`copyCode`에 `try { ... } catch { showToast('복사 실패') }` 형태로 실패 피드백 추가. 성공 시 토스트 문구·버튼 상태 변경 로직은 그대로 유지.
- **D (빈 상태 힌트)**: `EXPLORER_EMPTY_HTML`의 문구를 실제 버튼 라벨("열기")에 맞춰 `'위의 <strong>열기</strong> 버튼으로<br>폴더를 열어 탐색하세요.'`로 수정.

## 변경 파일
- `src/renderer/index.html` — split-mode 구분선 마크업/CSS 추가(A).
- `src/renderer/app-shell.js`, `src/renderer/editor.js` — 구분선 드래그 핸들러(A).
- `src/renderer/app-runtime.js` — `copyAll`/`copyCode` 클립보드 실패 처리(C).
- `src/renderer/explorer.js` — 빈 상태 힌트 문구 수정(D).
- `tests/unit/app-runtime.test.js`(C), `tests/unit/explorer.test.js`(D) — 신규 테스트.

## 적용된 수정 (2026-08-05)

### C. 클립보드 실패 피드백
`copyAll`/`copyCode`(`src/renderer/app-runtime.js`)의 `navigator.clipboard.writeText(...)` 호출을 `try/catch`로 감쌌다. reject 시 `showToast`로 실패 문구를 띄우고 즉시 `return` — 성공 경로의 `classList.add('copied')`/성공 토스트/`setTimeout` 되돌리기 로직은 실행하지 않는다(복사가 실제로 되지 않았으므로). 기존 토스트 톤과 일관되게 `copyAll` 실패는 `'복사 실패'`, `copyCode` 실패는 `'코드 복사 실패'`.

`tests/unit/app-runtime.test.js`에 `makeCopyHarness()` 헬퍼(jsdom 기반, `navigator.clipboard.writeText`를 reject/resolve하도록 스텁)를 추가하고 4건의 테스트로 성공/실패 양쪽 경로를 모두 고정했다. Node의 전역 `navigator`는 getter-only accessor라 `global.navigator = {...}`가 조용히 no-op되는 함정이 있었다 — `Object.defineProperty`로 우회.

### D. 빈 탐색기 힌트 문구
`EXPLORER_EMPTY_HTML`(`src/renderer/explorer.js:2`)을 `'위의 <strong>열기</strong> 버튼으로<br>폴더를 열어 탐색하세요.'`로 수정 — 실제 `#btn-add` 버튼 라벨("열기")과 일치시켰다. `tests/unit/explorer.test.js`에 `controller.clearExplorerRoot()`가 렌더링한 힌트가 `<strong>열기</strong>`를 포함하고 `<strong>+</strong>`를 포함하지 않는지 확인하는 테스트를 추가했다.

## 테스트 계획 (이력)
- A: 2026-08-04 구현 시 Electron 스모크에 분할뷰 진입 → 구분선 드래그 → 두 패널 폭 변경 확인 케이스가 함께 추가됐다.
- C, D: 위 "적용된 수정" 절의 유닛 테스트로 커버됨. `npm run test:unit` 128개 전부 통과(2026-08-05 확인).

## 리스크 / 미결정 사항
- A: 구분선 위치를 세션별로 영구 저장할지, 세션 내에서만 유지할지는 제품 결정이 필요하다 — 현재는 "세션 내 유지만" 구현돼 있고 영구 저장은 v2 후보로 남아 있다.
- C, D: 해소됨 — 별다른 리스크 없음.
