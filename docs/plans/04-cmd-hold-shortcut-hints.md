# 04. Cmd 키를 누르고 있으면 단축키 있는 버튼에 단축키 즉시 표시

## 상태
계획 (미착수)

## 문제
사용자가 Cmd 키를 누르고 있는 동안, 단축키가 존재하는 버튼들 위에 해당 단축키가 시각적으로(hover 없이도) 즉시 표시되길 원한다.

## 근거
- 현재 단축키 정보는 버튼의 `title`/`aria-label`에 텍스트로 박혀 있을 뿐이다 (예: index.html:1257 `title="저장 (⌘S)"`, index.html:1242 `title="검색 (⌘F)"`, index.html:1163 `title="열기"` — 이건 단축키 없음). 브라우저 네이티브 툴팁은 hover 후 지연시간을 거쳐야 뜨고, Cmd 홀드와는 무관하다.
- 시스템 단축키(메뉴 accelerator)는 `main.js#buildMenu`에 정의됨: `CmdOrCtrl+O/S/Shift+S/T/W/P/N/F/U/\/Shift+]/Shift+[` (main.js:442-532).
- 렌더러 버튼 중 `data-command` 속성으로 커맨드가 매핑되어 있음(예: index.html:1225 `id="btn-split" data-command="toggleSplitView"`) — 이 버튼들은 accelerator 목록에 없어 시스템 단축키가 없는 것으로 보임(분할뷰, 패널 토글, 전체 복사 등).
- 전역 키 이벤트를 다루는 곳은 `src/renderer/app-runtime.js`로 추정됨(기존 keydown 중복 실행 정리 이력이 있는 파일, app-runtime.js:355-356 주석 참고).

## 제안 방안
1. **`data-shortcut` 속성 추가**: 실제 단축키가 있는 버튼에 한해 `title`과 별도로 `data-shortcut="⌘S"` 형태의 속성을 부여한다. `main.js#buildMenu`의 accelerator 목록과 1:1 대조해, 시스템 단축키가 없는 버튼(예: 분할뷰, 패널 토글, 전체 복사, PDF 내보내기, 테마 전환 등)에는 붙이지 않는다 — 없는 단축키를 표시하면 오히려 혼란을 준다.
2. **전역 keydown/keyup/blur 리스너** (`app-runtime.js`에 추가):
   - `keydown`에서 `event.metaKey === true`가 되는 순간 `document.body.classList.add('cmd-held')`.
   - `keyup`(metaKey가 false로 바뀌는 시점) 또는 `window` `blur` 이벤트에서 클래스 제거. **`blur`를 반드시 같이 처리**해야 한다 — Cmd+Tab으로 다른 앱으로 전환하면 `keyup`이 이 창에 도달하지 않아 클래스가 눌어붙는(stuck) 상태가 될 수 있음.
3. **CSS**: `body.cmd-held [data-shortcut]::after` 같은 규칙으로, 단축키 문자열을 담은 작은 배지를 버튼 위/모서리에 오버레이한다. `content: attr(data-shortcut)`로 별도 텍스트 복제 없이 구현 가능.
4. macOS 전용 앱이므로(README 기준) `ctrlKey` 분기는 불필요, `metaKey`만 고려.

## 변경 파일
- `src/renderer/index.html` (버튼에 `data-shortcut` 추가 + CSS)
- `src/renderer/app-runtime.js` (전역 keydown/keyup/blur 리스너)

## 테스트 계획
- Electron 스모크 테스트: `metaKey: true`로 keydown 디스패치 후 `body.cmd-held` 클래스와 배지 `display`/가시성 확인, keyup 및 window blur 각각에 대해 클래스 해제 확인
- 수동 QA: 실제 Cmd 홀드로 배지가 즉시 뜨고 떼면 즉시 사라지는지, 다른 앱으로 Cmd+Tab 전환 후 복귀 시 눌어붙지 않는지 확인

## 리스크 / 미결정 사항
- 어떤 버튼까지 "단축키 있는 버튼"으로 볼지 범위 확정 필요(시스템 accelerator만? 아니면 검색 내 이전/다음/닫기 같은 로컬 키 힌트(Shift+Enter, Enter, Esc)도 포함할지). 우선 `main.js#buildMenu`에 정의된 시스템 단축키만 포함하는 것을 기본안으로 제시.
