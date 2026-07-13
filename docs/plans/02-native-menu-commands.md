# 02. 네이티브 메뉴에 대부분의 명령이 없음

## 문제

렌더러에는 단축키가 12개 있는데(`src/renderer/app-runtime.js:336-349`), 네이티브 메뉴는 **4개만** 노출한다.

```bash
$ grep -oE "sendRendererCommand\('[a-zA-Z]+'" src/main.js | sort -u
sendRendererCommand('openFile'
sendRendererCommand('openFolder'
sendRendererCommand('saveFile'
sendRendererCommand('saveFileAs'
```

메뉴에서 **완전히 빠진 것들**:

| 명령 | 단축키 | 현재 발견 경로 |
|------|--------|----------------|
| `newFile` | ⌘T | + 메뉴에만 |
| `closeCurrentTab` | ⌘W | 없음 |
| `toggleSource` | ⌘U | 툴바 버튼(단축키 표기 없음) |
| `toggleSplitView` | ⌘\ | 툴바 버튼(단축키 표기 없음) |
| `toggleSearch` | ⌘F | 툴바 버튼 |
| `printDoc` | ⌘P | 툴바 버튼 |
| `exportPdf` | — | 툴바 버튼 |
| `switchToNextTab` / `switchToPrevTab` | ⌘⇧] / ⌘⇧[ | **어디에도 없음** |
| `toggleTheme` | — | 툴바 버튼 |

`보기` 메뉴(`src/main.js:481-492`)는 Electron 기본 role(reload/zoom/devtools)만 있고 **앱 고유 명령이 하나도 없다**. `도움말` 메뉴 자체가 없다.

즉 ⌘\ (분할뷰), ⌘W (탭 닫기), ⌘⇧[ ] (탭 순환)은 **사용자가 알아낼 방법이 없다.** 툴바 버튼의 `title`도 "분할뷰"일 뿐 키 힌트가 없다.

## 왜 중요한가

macOS 사용자가 "이 앱 뭐 할 수 있지?"를 확인하는 곳은 메뉴바다. 게다가 메뉴에 `accelerator`를 달면 **단축키가 자동으로 표시**된다 — 따로 문서를 만들 필요가 없다.

기능은 이미 다 구현돼 있다. 발견 가능성만 없다.

## 접근

배관은 이미 다 깔려 있다. `main.js#sendRendererCommand`(415행)가 `app.js#createRendererCommands`의 레지스트리와 1:1로 매핑되므로, **메뉴 항목 추가는 객체 리터럴 몇 개가 전부다.**

1. **`파일` 메뉴**에 추가: `새 파일`(⌘T), `탭 닫기`(⌘W), 구분선, `PDF로 내보내기`, `인쇄`(⌘P).
2. **`편집` 메뉴**에 추가: 구분선 + `찾기`(⌘F). (기존 undo/redo/cut/copy/paste role은 유지.)
3. **`보기` 메뉴** 맨 위에 앱 고유 항목 추가: `소스 보기`(⌘U), `분할뷰`(⌘\), `테마 전환`, 구분선, `다음 탭`(⌘⇧]), `이전 탭`(⌘⇧[), 그 뒤에 기존 reload/zoom role들.
4. **`도움말` 메뉴 신설**: `단축키` 항목 → 렌더러에 `showShortcuts` 커맨드를 새로 만들어 정적 시트를 띄운다.

**중복 실행 주의:** 메뉴에 `accelerator`를 달면 그 키는 이제 **메뉴가 처리**한다. 렌더러의 전역 `keydown` 핸들러(`app-runtime.js:336-349`)에도 같은 키가 남아 있으면 한 번 누를 때 명령이 두 번 실행될 수 있다(예: ⌘T가 새 탭 2개). 각 키를 메뉴로 옮길 때 렌더러 핸들러에서 **반드시 제거**하거나, 반대로 메뉴에서 `accelerator`를 빼고 표시용으로만 두어야 한다.
→ **권장:** `accelerator`는 메뉴에 두고(표시 + 처리), 렌더러 keydown에서 해당 항목을 지운다. 단, 텍스트 입력 중에도 동작해야 하는 키(⌘S 등)는 메뉴 accelerator가 정상 동작하므로 문제없다.

이건 이 작업의 유일한 실질적 함정이다. 옮길 때마다 e2e로 "한 번 눌렀을 때 한 번만 실행"을 확인할 것.

## 파일

- `src/main.js#buildMenu` (424-500행 부근) — 메뉴 항목 추가
- `src/renderer/app-runtime.js:336-349` — 메뉴로 이관한 키를 keydown에서 제거
- `src/renderer/app.js#createRendererCommands` — `showShortcuts` 커맨드 추가
- `src/renderer/index.html` — 단축키 시트 마크업(기존 `#welcome-guide` 스타일 재사용)

## 검증

- e2e: 각 메뉴 항목을 `Menu.getApplicationMenu()`로 찾아 `click()` 호출 → 해당 동작이 일어나는지.
- **중복 실행 회귀 테스트**: ⌘T를 한 번 눌렀을 때 탭이 정확히 1개만 늘어나는지. 위 함정을 직접 겨냥한 테스트다.
- 수동: 메뉴바를 열어 단축키가 표기되는지 눈으로 확인.
