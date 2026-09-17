# 인앱 업데이트 알림(notify-only) 기능 추가

## 상태
**구현·검증 완료** (2026-08-18). 유닛 206개(신규 21개: `update-checker.test.js` 12 + `update-notice.test.js` 9) + 컨트롤러 12개 + Electron 스모크 89개(신규 5개) 전부 통과. 실제 GitHub Releases API에 대한 수동 검증도 완료: (1) 실제 저장소(`oiysful/MDV`, 최신 태그 `v1.2.0` = 현재 버전)로 배너가 뜨지 않음을 확인, (2) `MDV_REPO_OWNER=sass MDV_REPO_NAME=dart-sass`로 실제 더 높은 태그(`1.102.0`, `v` 접두사 없음)를 붙여 실제 네트워크 요청→배너 노출 전체 경로를 스크린샷으로 확인하고, 아래 수정된 릴리스 URL(`https://github.com/sass/dart-sass/releases/tag/1.102.0`)이 실제로 200을 반환함을 `curl`로 재확인.

**2026-09-17 — MDV 자신의 실제 릴리스로 재검증 완료.** 위 (2)는 다른 저장소를 빌린 대리 검증이었고, 이번에 그 대리 조건이 사라졌다. v1.3.0 릴리스에서 순서를 이렇게 잡았다: 버전을 올리기 **전에** 현재 HEAD를 빌드해 `/Applications`에 설치(앱은 1.2.0으로 보고하면서 체커 코드는 최신) → 그 다음 bump·태그·릴리스 게시 → `~/Library/Application Support/MDV/update-check.json`을 지워 24시간 스로틀을 풀고 설치본을 `open -a`로 실행. `update-check.json`에 `latestVersion: "1.3.0"`이 기록되고 배너("MDV 1.3.0 버전이 있습니다" + 릴리스 노트/`brew upgrade` 복사)가 실제로 떴다. 버전을 먼저 올리면 릴리스와 앱 버전이 같아져 이 경로는 테스트할 수 없다.

계획 대비 구현 시 갈라진 지점 두 가지:
- 컨트롤러 테스트는 `tests/controller/`가 아니라 `tests/unit/update-notice.test.js`로 작성 — `tests/controller/helpers/harness.js`는 워크스페이스/에디터/검색 컨트롤러 간 **배선**을 검증하는 전용 하네스이고, update-notice는 `search.js`처럼 독립적으로 인라인 JSDOM 위에서 직접 구동 가능한 단일 컨트롤러라 `tests/unit/search.test.js`의 기존 선례를 따름.
- `app-shell.js`의 `createAppShellController`에 `onUpdateAvailable` 파라미터를 추가하지 않음 — `app.js`가 이미 `onRestoreSession`을 app-shell을 거치지 않고 `window.api.onRestoreSession?.(...)`로 직접 배선하는 기존 패턴이 있어, `onUpdateAvailable`도 동일하게 `app.js`에서 직접 배선(더 적은 파라미터 스레딩).

advisor 리뷰(1차 구현 직후)에서 발견해 반영한 것:
1. **릴리스 URL 버그**: `releaseUrlFor(version)`이 `v${version}`을 재조합해 URL을 만들었는데, GitHub 태그가 `v` 접두사 없는 저장소(`sass/dart-sass`의 `1.102.0` 등)에서는 404가 나는 구조였다. `release.tagName`(실제 발급된 태그 문자열)을 그대로 URL에 쓰도록 고치고, 스로틀된 재평가 경로도 같은 URL을 만들 수 있도록 `update-check.json`에 `latestTag` 필드를 추가로 영속화했다.
2. **인쇄/PDF 노출**: `#update-banner`가 `@media print` 숨김 목록에 없어서 PDF 내보내기·인쇄에 그대로 찍힐 뻔했다 — `#toast`/`#welcome-guide`와 달리 이 배너는 문서가 열려 있는 동안 지속적으로 표시될 수 있어 `.copy-btn`과 같은 부류(인쇄 시 숨겨야 하는 지속형 오버레이)에 속한다. 목록에 추가하고, `page.emulateMedia({ media: 'print' })`로 검증하는 Electron 테스트를 추가했다.
3. 응답 본문을 안 읽고 버리는 비-200 분기에 `response.destroy?.()` 호출 추가(요청/응답 스트림 정리), 오해를 부르던 테스트 이름 하나 수정.

## Context

사용자가 Electron의 `autoUpdater`를 붙여서 현재 Homebrew 배포 방식과 병행할 수 있는지 물어봤다. 조사 결과:

- MDV는 electron-builder로 macOS arm64 `.zip`만 빌드하며, **완전히 unsigned·un-notarized** 상태다 (`CSC_IDENTITY_AUTO_DISCOVERY=false`, Apple Developer ID 없음). Cask의 `postflight`에서 quarantine 속성을 수동으로 제거해 Gatekeeper를 우회하고 있다.
- Electron의 네이티브 `autoUpdater`(Squirrel.Mac)와 `electron-updater` 모두 macOS에서 업데이트를 적용하려면 **유효한 코드 서명이 필수**다. 서명이 없으면 다운로드는 되어도 적용이 거부된다.
- Homebrew 배포는 Formula가 아니라 **Cask**(`oiysful/homebrew-tap`, `Casks/mdv.rb`)이며, Cask는 `auto_updates true`로 자체 업데이트 앱과 공존 가능 — 즉 Homebrew 자체는 걸림돌이 아니다. **진짜 걸림돌은 코드 서명 부재**다.
- 코드 서명을 하려면 Apple Developer Program 가입(연 $99) + CI 서명/공증 파이프라인 구축이 필요해 비용/작업량이 크다.

사용자는 이 트레이드오프를 듣고 **비용이 들지 않는 "알림 전용" 방식**을 선택했다: 자동 다운로드/설치는 하지 않고, GitHub Releases를 폴링해서 새 버전이 있으면 앱 안에 배너를 띄워 `brew upgrade --cask oiysful/tap/mdv` 실행을 안내한다.

**명시적으로 범위 밖:** 코드 서명, notarization, `electron-updater`/Squirrel.Mac, 자동 다운로드/설치, `.dmg` 생성, `package.json#build` 변경. 이 기능은 업데이트 "메커니즘"을 건드리지 않고 "알림"만 추가한다.

**현재 상태: 미착수.** 이 문서는 계획 단계이며, 사용자 승인 후 구현을 시작한다.

## 재사용할 기존 패턴

- IPC 요청/응답: `ipcMain.handle('open-external-url', ...)` (src/main.js:352-362) — URL이 http(s)인지 검증 후 `shell.openExternal` 호출. 릴리스 노트 링크 열기에 그대로 재사용.
- IPC push: `win.webContents.send('theme-changed', ...)` (src/main.js:233), preload에서 `ipcRenderer.on(...)` 래핑 (src/preload.js:3, `contextBridge.exposeInMainWorld('api', {...})`).
- 버전 조회: `app.getVersion()` — 이미 About 패널(src/main.js:213-222)에서 사용 중, package.json version과 항상 동기화됨.
- 영속 저장: `session.json` 패턴 (src/main.js:29-54) — `app.getPath('userData')` 하위 JSON 파일, try/catch로 조용히 실패. 새 파일 `update-check.json`도 동일 패턴.
- 테스트 격리: `MDV_USER_DATA_DIR` 환경변수 가드 (src/main.js:9-13) — 새 영속 파일도 자동으로 격리됨.
- Toast: `showToast` (src/renderer/onboarding.js:34-41)는 1.6초 자동 소멸형 단문 토스트라 지속형 배너에는 부적합 → 새 배너 컴포넌트를 만들되, 복사 성공/실패 알림에는 기존 `showToast` 재사용.
- 렌더러 CSS는 전부 `src/renderer/index.html`의 인라인 `<style>` 블록에 있음 (별도 .css 파일 없음).
- 네트워크 호출은 이 앱에서 처음 — 새 의존성 추가 없이 Electron 내장 `net.request` 사용 (시스템 프록시 존중).

## 구현 계획

### 1. `src/update-checker.js` (신규, Electron 비의존 순수 모듈)

버전 비교/정규화 로직만 담당. `session-state.js`처럼 main과 테스트에서 공용 `require`.

- `parseVersion(str)` — `^v?(\d+)\.(\d+)\.(\d+)$` 매칭, 실패 시 `null` (프리릴리스 태그 `v1.3.0-beta.1` 등은 통째로 거부).
- `normalizeTag(tag)` — `"X.Y.Z"` 문자열로 정규화 또는 `null`.
- `compareVersions(a, b)` — semver 숫자 비교(`1.10.0 > 1.9.0`을 문자열 비교로 잘못 판정하는 실수 방지), 파싱 실패 시 `null`.
- `isNewerRelease(remoteTag, currentVersion)` — bool.
- `shouldNotify({ latestVersion, currentVersion, dismissedVersion })` — 최신 버전이 더 높고, 아직 그 버전을 dismiss하지 않았을 때만 true.

정규화된 버전 문자열은 숫자·점만 포함하므로 이후 렌더러에서 `textContent`로 안전하게 삽입 가능.

### 2. `src/main.js` — 오케스트레이션

**영속 상태** (`update-check.json`, `session.json`과 동일 패턴):
```
{ lastCheckedAt: number, latestVersion: string|null, dismissedVersion: string|null }
```
`getUpdateCheckFilePath` / `readUpdateCheckState` / `writeUpdateCheckState` 함수 추가.

**네트워크 조회** — `fetchLatestReleaseTag()`:
- 엔드포인트: `https://api.github.com/repos/oiysful/MDV/releases/latest` (draft/prerelease를 서버 측에서 제외해주므로 `/tags`보다 적합; `scripts/common.sh`가 이미 이 엔드포인트를 씀).
- `User-Agent`, `Accept` 헤더 필수 (없으면 GitHub이 403).
- 타임아웃 10초, 응답 바디 1MB 상한, 모든 실패 경로(오프라인·비200·타임아웃·JSON 파싱 실패)는 예외 없이 `null` 반환 — 백그라운드 체크 실패를 사용자에게 절대 노출하지 않음.
- 릴리스 페이지 URL은 응답의 `html_url`을 그대로 쓰지 않고, 정규화된 태그로 로컬에서 직접 조립 (`https://github.com/oiysful/MDV/releases/tag/${tagName}`) — 3rd-party 응답 문자열을 검증 없이 IPC로 넘기지 않기 위함.

**오케스트레이터** — `maybeCheckForUpdate()`:
- `MDV_TEST_SKIP_UPDATE_CHECK` 환경변수가 설정되면 즉시 반환 (테스트 유일 게이트).
- 24시간 스로틀: `lastCheckedAt`이 24시간 이내면 네트워크 호출 없이 저장된 `latestVersion`으로 `shouldNotify` 재평가만 하고 필요시 배너 재전송 (재실행마다 배너가 다시 보이게 하기 위함 — 스로틀은 "네트워크 호출"에만 걸리고 "알림 표시"에는 안 걸려야 함).
- 스로틀 기간이 지났으면: 요청 시작 전에 `lastCheckedAt`부터 먼저 기록(요청 중 크래시가 매 실행마다 재시도로 이어지지 않도록) → fetch → 성공 시 `latestVersion` 갱신 저장 → `shouldNotify`면 모든 창에 브로드캐스트.
- 실행 위치: `app.whenReady().then(...)` 안에서 `createWindow()` 호출 **이후**, `setTimeout(..., 5000)`으로 지연 실행. `did-finish-load`에는 걸지 않음 — 이 이벤트는 창마다(Cmd+N 포함) 매번 발생하므로 거기 걸면 창 개수만큼 중복 fetch/타이머가 생김. 앱 실행당 1회, `setInterval` 없음(정리할 것도 없음).
- Cmd+N 등으로 나중에 열리는 창: 기존 `did-finish-load` 핸들러(main.js:107-115)에 한 줄 추가해 `cachedUpdateInfo`가 있으면 즉시 전송.
- 과거 성능 이슈(mermaid/katex/session-tab lazy-load로 해결한 시작 프리즈 버그) 재발 방지를 위해 시작 경로에 동기 작업을 절대 추가하지 않는다.

**IPC 핸들러**: `ipcMain.on('dismiss-update-notice', (_, version) => {...})` — 상태에 `dismissedVersion` 저장, 모든 창에 `null` 페이로드 브로드캐스트해 배너 숨김.

### 3. `src/preload.js`
```js
onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, data) => cb(data)),
dismissUpdateNotice: (version) => ipcRenderer.send('dismiss-update-notice', version),
```

### 4. IPC 계약

| 채널 | 방향 | 페이로드 |
|---|---|---|
| `update-available` | main → renderer (push) | `null`(숨김) 또는 `{ version, tagName, releaseUrl }` |
| `dismiss-update-notice` | renderer → main | `version: string` |

`open-external-url`은 릴리스 노트 링크에 그대로 재사용 (새 채널 불필요).

### 5. `src/renderer/update-notice.js` (신규 컨트롤러, `onboarding.js`와 동일한 팩토리 패턴)

- `handleUpdateAvailable(data)` — 배너 표시/숨김 + 텍스트 갱신.
- `dismiss()` — `api.dismissUpdateNotice(version)` 호출 후 숨김.
- `openReleaseNotes()` — `api.openExternalUrl(releaseUrl)`.
- `copyUpgradeCommand()` — `navigator.clipboard.writeText('brew upgrade --cask oiysful/tap/mdv')`, 성공/실패 각각 `showToast`로 안내 (try/catch 필수).
- `isBlockedByModal` — `onboardingController.isDefaultAppGuideOpen()`을 주입받아, 최초 실행 가이드 모달이 떠 있는 동안은 배너를 숨김. 모달이 닫힐 때 `recheckVisibility()` 호출해 재평가.

### 6. `src/renderer/index.html`

- `#update-banner` 마킹업 추가 (텍스트, "brew upgrade 명령어 복사" 버튼, "릴리스 노트" 링크, 닫기 버튼) — `#toast` 근처(라인 ~1455)에 배치. **릴리스 노트 링크를 명령어 복사보다 앞/위에 배치** (아래 "알려진 한계" 참고 — brew 명령이 당장 먹히지 않을 수 있으므로 사용자가 먼저 확인할 수 있는 경로를 우선 노출).
- CSS: 기존 토큰(`var(--surface)`, `var(--shadow-sm)`, `var(--radius-md)`) 재사용, `position: fixed; bottom/right`, `z-index: 480` (welcome-guide 510, default-app-guide/shortcuts-guide 540보다 낮게 — 모달과 시각적으로 겹치지 않도록).
- `<script src="./update-notice.js">` 추가 (onboarding.js 스크립트 태그 근처).

### 7. `src/renderer/app.js` / `app-shell.js` 배선

- `app.js`: `onboardingController`/`searchController`와 나란히 `updateNoticeController` 생성.
- `app-shell.js#collectAppShellRefs`: `updateBanner`, `updateBannerText` ref 추가.
- `app-shell.js#createAppShellController` / `registerIpcHandlers()`: `onUpdateAvailable` 파라미터 추가 및 `api.onUpdateAvailable(...)` 등록.
- `app.js#createRendererCommands()`: `dismissUpdateBanner`, `openUpdateReleaseNotes`, `copyUpdateCommand` 커맨드 추가.
- 기본 앱 가이드 모달 닫힘 처리 지점에 `updateNoticeController.recheckVisibility()` 호출 추가.

CSP 변경 불필요 — 네트워크 호출이 전부 main 프로세스(`net.request`)에서 일어나고 렌더러는 `fetch`를 쓰지 않으므로 `tests/unit/csp.test.js`는 영향 없음.

### 8. 테스트

- `tests/unit/update-checker.test.js` (신규, 순수 함수 테스트): `1.10.0 > 1.9.0` 같은 semver 함정, 동일 버전, 로컬이 더 최신인 경우, `v` 접두사, 프리릴리스 거부, 잘못된 태그(`latest`, `''`) 거부, dismiss 억제 및 새 버전 등장 시 재노출.
- `tests/controller/update-notice.test.js` (신규): jsdom + `api` 스텁으로 배너 표시/숨김, dismiss 호출, 릴리스 노트 링크, 클립보드 복사 성공/실패 토스트, 모달에 의한 억제를 검증. `tests/controller/helpers/harness.js`의 `DOM_TEMPLATE`/`createRefs`에 새 엘리먼트 id 추가 필요.
- Electron 스모크 (`tests/electron/menu-and-guides.test.js` 또는 신규 파일): 실제 네트워크를 치지 않고 `electronApp.evaluate`로 `update-available` 이벤트를 합성 주입해 배너 렌더링·dismiss·복사 동작을 검증.
- `tests/electron/helpers/launch.js`: 기본 env에 `MDV_TEST_SKIP_UPDATE_CHECK: '1'` 추가해 일반 테스트 실행 시 네트워크 호출이 전혀 발생하지 않도록 함.
- 실제 GitHub API를 치는 end-to-end 확인은 자동화 테스트가 아니라 배포 전 수동 스모크로 처리 (CI에서 외부 네트워크 의존 테스트는 지양).

### 9. 문서

`AGENTS.md`, `src/renderer/AGENTS.md`의 CODE MAP / WHERE TO LOOK 표에 새 모듈(`update-checker.js`, `update-notice.js`)과 IPC 채널 2개를 추가.

## 알려진 한계

GitHub Release가 게시된 시점과 Homebrew tap의 `Casks/mdv.rb`가 갱신되는 시점 사이에 지연/누락 가능성이 있다. `scripts/update-homebrew-tap.sh`는 릴리스 워크플로 안에서 자동 실행되지만, `HOMEBREW_TAP_TOKEN` 시크릿이 설정돼 있지 않으면 **조용히 스킵(exit 0)**되고 cask 버전은 그대로 남는다. 이 경우:

- 배너는 "새 버전 있음"을 정확히 알리지만, 사용자가 `brew upgrade --cask oiysful/tap/mdv`를 실행해도 "이미 최신"이라며 아무 일도 안 일어난다.
- 다음 실행 때 배너가 다시 뜬다(사용자 입장에서는 "안 없어지는 알림"으로 보일 수 있음).

완화책으로 배너에서 **릴리스 노트 링크를 brew 명령어보다 먼저 노출**한다(위 6번 항목 반영) — 최소한 사용자가 "새 버전이 릴리스는 됐다"는 사실 자체는 확인 가능. 근본 해결은 두 가지 중 택1이며 이번 범위에는 포함하지 않는다: (a) `RELEASING.md`에 "릴리스 태그 푸시 후 tap 저장소의 cask 버전이 실제로 갱신됐는지 확인" 체크리스트 항목 추가, 또는 (b) release 워크플로에서 tap 업데이트 스텝 실패/스킵 시 알림(Slack 등)을 받도록 CI 보강. cask 버전을 실시간으로 감지해서 배너 문구를 바꾸는 것은 notify-only 기능치고 과한 범위이므로 하지 않는다.

## 대상 파일

- `src/update-checker.js` (신규)
- `src/main.js`
- `src/preload.js`
- `src/renderer/update-notice.js` (신규)
- `src/renderer/index.html`
- `src/renderer/app.js`
- `src/renderer/app-shell.js`
- `tests/electron/helpers/launch.js`
- `tests/unit/update-checker.test.js` (신규)
- `tests/controller/update-notice.test.js` (신규) + `tests/controller/helpers/harness.js`
- `tests/electron/menu-and-guides.test.js` (또는 신규 스모크 파일)
- `AGENTS.md`, `src/renderer/AGENTS.md`

## 검증

1. `npm run test:unit` — `update-checker.test.js`의 버전 비교 케이스 전부 통과 확인.
2. `npm run test:controller` — 배너 컨트롤러 동작(표시/숨김/복사/링크) 확인.
3. `npm run test:electron` — 합성 이벤트로 배너 스모크 테스트, 그리고 일반 실행 시 `MDV_TEST_SKIP_UPDATE_CHECK`로 네트워크 호출 없음 확인.
4. 로컬에서 `MDV_REPO_OWNER`/`MDV_REPO_NAME`을 실제 태그 있는 저장소로 지정하고 `npm start`로 실행해 실제 GitHub API 응답으로 배너가 뜨는지 수동 확인 (package.json version을 일부러 낮춰서 테스트).
5. `brew upgrade --cask oiysful/tap/mdv` 명령어 복사 버튼 클릭 후 실제로 클립보드에 정확한 문자열이 들어가는지 확인.
