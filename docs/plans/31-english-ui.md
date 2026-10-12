# 31. 영어 UI 추가(한국어 + 영어) — 계획 12 재검토

## 상태
**조사 완료(2026-10-12). 방향 결정(2026-10-12, Ian): 권장안** — 시스템 언어를 따르고(앱 안 설정 없음), 한국어·영어 외 시스템 언어는 영어로 한다. 이 방향의 성능·용량은 §8에서 실측했다. 착수 시점과 §7의 4·5번은 미정. [계획 12](./12-i18n-feasibility-assessment.md)(2026-08-12,
전면 i18n 타당성)를 "영어 하나만 추가"로 범위를 좁혀 다시 본 보고서다. 앱 코드는 바꾸지 않았다.

**이 문서에서 "영어만 추가"의 뜻**: 지금의 한국어 UI는 문구 하나 바꾸지 않고 그대로 기본값으로 둔다. 거기에
영어 한 벌을 더한다. i18n 라이브러리, 복수형·ICU 메시지 포맷, 앱 안에서의 언어 전환 토글은 넣지 않는다.
한국어를 영어로 **교체**하는 안은 범위 밖이다(주 사용자가 한국어 사용자다).

## 요약
- **언어를 앱 시작 때 한 번만 정하면 계획 12의 큰 구조 비용 두 개가 사라진다.** 네이티브 메뉴 재빌드 배선(계획 12
  §3)이 필요 없다. 메뉴는 지금도 `whenReady`에서 한 번만 만든다. 언어별 별도 빌드 채널(제안 4)도 필요 없다. 이것이
  macOS 앱의 관례이기도 하다. 실측해 보니 macOS의 앱별 언어 설정 키(`AppleLanguages`)를 Electron이 그대로 따랐다(§2).
- **테스트 재정비가 "최대 병목"에서 "새 테스트 몇 개"로 줄어든다.** 테스트가 로캘을 `ko`로 고정하면 한국어를
  assert하는 기존 테스트 20개 파일·144줄을 손대지 않는다. 고정하지 않으면 **로컬(ko-KR)에선 통과하고 CI에서만
  깨진다**(§3).
- 실제 작업은 문자열 약 149개를 기계적으로 옮기는 것과 영어 번역이다. 계획 12가 말한 "코드베이스를 가로지르는
  리팩터링" 규모는 아니다.
- **지금도 메뉴는 이미 세 언어가 섞여 있다**(설치된 v1.4.0 실측). 직접 붙인 항목은 한국어, `role` 항목(Undo·Copy·Quit 등)은
  영어, macOS가 넣는 항목은 한국어다. 앱 메뉴는 소문자 `About mdv`/`Quit mdv`로 나온다. 영어 추가와 함께 정리하거나,
  앱 이름은 먼저 따로 고칠 수 있다(§4).

## 1. 계획 12 수치 재측정 (2026-08-12 → 2026-10-12)

| 항목 | 계획 12 | 지금 | 비고 |
|---|---|---|---|
| 한국어가 든 코드 줄(주석 제외) | 171줄 | 182줄 | 그중 **11줄은 `console.*` 로그**(번역 대상 아님). UI는 약 171줄로 사실상 같다 |
| 고유 문자열 | ~120–140개(추정) | ~149개(조각 단위 집계) | `index.html`의 `title`/`aria-label` 중복 포함 |
| 파일별 UI 줄 | — | `index.html` 81, `main.js` 32(로그 2), `app-runtime.js` 12, `workspace.js` 12, `app-shell.js` 11(로그 4), `markdown.js` 9(로그 4), `explorer.js` 7, `document-flow.js` 6, `editor.js` 4, `update-notice.js` 3(계획 12 이후 신설), 그 외 4개 파일 각 1–2 | |
| 한국어가 든 테스트 | 21개 파일·90줄+ | **20개 파일(44개 중)·144줄** | 늘었다. 단 `tests/unit/markdown.test.js` 25줄처럼 **한국어가 UI가 아니라 테스트 데이터**(물결표·슬러그 입력)인 줄이 섞여 있다. UI assert는 `menu-and-guides`(35)·`boot-and-render`(25)·`app-runtime`·`explorer-and-shell`·`links-and-toc` 등에 몰려 있다 |

계획 12가 지적한 난이도 차이는 그대로다. 정적 라벨, 조사가 붙는 동적 메시지, 메인 프로세스의 메뉴·대화상자,
네이티브 `alert`/`confirm`(렌더러 5곳)/`showMessageBoxSync`(`main.js:277`)가 있다. 범위를 좁히면서 달라지는 것은
아래 §2·§3이다.

## 2. 언어는 앱 시작 때 한 번 정한다

### macOS의 앱별 언어 설정을 그대로 따른다 — 실측
macOS는 "시스템 설정 > 일반 > 언어 및 지역 > 응용 프로그램"에서 앱마다 언어를 고르게 한다. 이 설정은 그 앱의
`AppleLanguages` 기본값으로 저장되고, 바꾸면 앱이 다시 시작된다. 같은 키를 실행 인자로 주는 방법으로 확인했다
(영속되지 않는다).

| 실행 방법 | `app.getLocale()` | `app.getPreferredSystemLanguages()` |
|---|---|---|
| 평소(Ian의 Mac) | `ko` | `["ko-KR", "en-KR"]` |
| `-AppleLanguages '(en)'` 인자 | `en-US` | `["en"]` |

따라서 **앱 안에 언어 설정을 둘 필요가 없다**. 시스템 언어를 따르고, 앱별로 바꾸고 싶으면 macOS 설정을 쓰면 된다.
단 MDV가 그 설정 화면의 앱 목록에 나타나는지, 나타난다면 어떤 언어를 보여 주는지는 번들의 지역화 선언에 달렸다.
지금은 Chromium 로캘 55개가 `.lproj`로 들어 있다. 이 부분은 측정하지 않았다(§4의 `electronLanguages`와 함께 확인).

### 정책
- 시작할 때 `app.getLocale()`이 `ko`로 시작하면 한국어, 그 밖에는 **영어**로 한다.
- **동작이 바뀌는 사람**: 한국어가 아닌 시스템 언어로 쓰는 사용자는 지금 한국어 UI를 보지만 이후 영어를 본다. 그것이
  이 작업의 목적이다. Ian의 Mac(ko-KR)은 그대로다.
- 언어가 실행 중에 바뀌지 않으므로 다음 것들이 필요 없다.
  - 계획 12 §3·제안 2: 메뉴 재빌드 경로와 렌더러→메인 언어 IPC
  - 계획 12 제안 4: 언어별 별도 빌드·배포 채널(cask가 둘이 되고 릴리스 작업이 두 배가 되는 안)
  - 계획 12 §5: `theme.js` 패턴의 런타임 컨트롤러. 렌더러는 시작할 때 받은 값을 쓰기만 한다

## 3. 테스트 — 로캘을 고정하면 기존 테스트는 그대로 둔다

**함정**: 로캘을 OS에서 자동으로 정하면 Ian의 로컬(ko-KR)에서는 모든 테스트가 통과한다. 하지만 GitHub의 macOS
러너는 영어 환경으로 알려져 있어(착수 시 CI 로그로 확인), 한국어를 assert하는 Electron 테스트가 **CI에서만** 깨진다.
이 프로젝트가 여러 번 겪은 "CI에서만 빨강" 유형이다(계획 18·19·20).

**해결**: 강제 로캘 환경 변수(가칭 `MDV_LOCALE=ko|en`)를 둔다. `tests/electron/helpers/launch.js:120`에서 지금
`MDV_TEST_SKIP_DEFAULT_APP_CHECK`를 넣는 자리에 기본값 `ko`를 함께 넣는다.
- 기존 Electron 테스트: 한국어 문자열이 ko 테이블에 **글자 그대로** 남으므로 한 줄도 바꾸지 않는다.
- 기존 단위 테스트: `index.html`의 정적 마크업은 한국어를 그대로 본문으로 두고 영어는 시작할 때 덮어쓴다(§4).
  따라서 `index.html`을 읽는 jsdom 테스트(`explorer.test.js`, `theme.test.js`)도 그대로다.
- **렌더러 쪽 기본 로캘은 `ko`로 한다.** jsdom 단위 테스트는 렌더러 JS가 만드는 한국어 문구(토스트, `title`, 빈 상태
  안내 등)도 assert한다(`app-runtime` 8줄, `editor` 5줄, `explorer` 4줄 등). preload가 없어 로캘을 전달받지 못하는
  환경에서는 `t()`가 `ko`를 써야 이 테스트들이 그대로 통과한다. 메인 프로세스 정책의 기본값(ko가 아니면 `en`)과
  **반대**이므로, 구현할 때 두 기본값을 헷갈리지 않도록 코드에 명시한다.
- 새로 쓸 테스트는 세 가지다.
  - (a) 테이블 일치성 단위 테스트: 두 언어의 키 집합이 같은지, 함수형 문구의 인자 수가 같은지
  - (b) **한글 리터럴 가드**: `src/` 아래에서 주석·로그·문자열 테이블을 뺀 곳에 한글이 남았는지 검사한다. 빠뜨린 문자열을 잡는다
  - (c) `MDV_LOCALE=en` Electron 스모크: 메뉴 라벨, 대표 버튼 몇 개, 대화상자 1건

계획 12가 "1~4단계를 합친 것과 비슷하거나 더 크다"고 본 테스트 재정비가 이 정도로 줄어드는 것이 범위를 좁힌
가장 큰 효과다.

## 4. 설계 (최소안)

- **문자열 테이블 한 파일**: `src/i18n/strings.js`(가칭). `markdown.js`처럼 `module.exports`(메인)와 전역(렌더러
  `<script>`) 양쪽으로 내보낸다. 형태는 `{ ko: {…}, en: {…} }`.
- **조사 문제는 함수형 값으로 피한다**: 값은 문자열 또는 `name => …` 함수다. 언어마다 문장 **전체**를 소유하므로
  `"${name}"이(가) 외부에서 변경되었습니다` 같은 한국어 문구는 지금 글자 그대로 ko 쪽에 남는다. 계획 12의
  "조사 처리 방식 결정 필요"는 이 범위에서는 결정할 것이 없다.
- **로캘 전달**: 메인이 시작할 때 정한다. 렌더러에는 `webPreferences.additionalArguments`(예: `--mdv-locale=en`)로
  넘기고 preload가 `api.locale`로 노출한다. 동기라서 첫 화면이 한국어로 깜빡이지 않는다. `<html lang="ko">`도 같이 바꾼다.
- **`index.html` 정적 마크업(81줄)**: 한국어를 본문으로 둔 채 `data-i18n`(텍스트)·`data-i18n-title`·`data-i18n-aria-label`
  속성으로 키만 단다. `en`일 때 시작 시 한 번 훑어 바꾼다.
- **렌더러 JS(약 60줄, 11개 파일)**: 리터럴을 `t('key')` / `t('key', name)`로 바꾼다.
- **메인 프로세스(30줄)**: 메뉴 라벨, `showMessageBoxSync` 문구, 사용자에게 보이는 IPC 오류 문구.
- **`role` 항목 라벨**: 지금 영어로 나오는 `role` 항목 약 22개(앱 메뉴 6, 편집 6, 보기 7, 창 3)에 테이블에서
  `label`을 준다. 그러면 한국어 모드의 혼합이 사라진다. Electron 문서는 role 라벨이 `Role::Label()`로 자동 지역화된다고
  설명하지만, **실측은 ko 시스템에서도 영어였다**(아래). macOS에서 `role` 항목에 효과가 있는 옵션은 `label`과
  `accelerator`뿐이다(Electron 문서).

  설치된 v1.4.0을 ko-KR 시스템에서 System Events로 읽은 실제 메뉴:

  | 메뉴 | 항목 |
  |---|---|
  | MDV | `About mdv`, `Services`, `Hide mdv`, `Hide Others`, `Show All`, `Quit mdv`, `종료 및 윈도우 유지` |
  | 편집 | `Undo`, `Redo`, `Cut`, `Copy`, `Paste`, `Select All`, `찾기…`, `글쓰기 도구`, `자동 완성`, `받아쓰기 시작…`, `이모지 및 기호` |
  | 창 | `Minimize`, `Zoom`, `Bring All to Front` |

  `종료 및 윈도우 유지`, `글쓰기 도구` 등은 macOS가 넣는 항목이라 시스템 언어(번들 지역화)를 따른다.
- **앱 이름 소문자(`mdv`)**: `package.json`에 최상위 `"name": "mdv"`만 있고 최상위 `productName`이 없다(`build.productName`만
  `MDV`). 그래서 `app.name`이 `mdv`다. i18n과 무관하게 먼저 고칠 수 있다. **주의**: `userData` 경로가 `app.name`을
  따르고 지금은 `~/Library/Application Support/mdv`다. 기본 APFS(대소문자 무시)에서는 `MDV`로 바꿔도 같은 폴더지만,
  대소문자를 구분하는 볼륨에서는 세션·업데이트 확인 기록을 잃는다. 이름을 바꿀 때 `userData`를 기존 경로로 고정한다.
- **`electronLanguages: ['ko', 'en']`**(electron-builder): Electron Framework 안의 로캘 리소스가 지금 **49MB**다(앱 424MB).
  두 언어만 남기면 macOS가 넣는 메뉴 항목과 시스템 패널의 언어도 두 언어 안에서 정해져 앱 UI와 어긋나지 않는다.
  실측 결과는 §8에 있다. 다운로드가 12MB 줄었고, 일본어 시스템에서 Electron 로캘이 `en-US`로 떨어져 위 정책과 맞았다.
- **번역하지 않는 것**: `console.*` 로그(11줄), 사용자 문서·파일 이름. 숫자는 이미 `toLocaleString()`을 쓴다.
  `약 N분` 같은 통계 문구만 테이블로 옮긴다.
- **문서**: README의 "UI는 한국어 전용" 제한사항과 라벨 영어 병기는 영어 라벨로 바꾼다. 영어 README의
  스크린샷을 영어 UI로 다시 찍을지는 선택이다.

## 5. 규모 재산정 — 계획 12의 6단계와 비교

| 단계 | 계획 12(전면 i18n·런타임 전환) | 이 범위 |
|---|---|---|
| 1 인프라 | 두 프로세스용 로더 + `createI18nController` | 테이블 한 파일 + `t()` + 시작 시 로캘 전달 |
| 2 추출·치환(~149개) | 같음 | 같음. 양으로는 가장 크지만 기계적이다 |
| 3 메뉴 재빌드 배선 | 새 IPC 흐름 | **없음** |
| 4 번역 | 미정 | 약 150개 영어 문구. 초안 작성 후 Ian 검수 |
| 5 테스트 재정비 | 최대 병목(1–4 합 이상) | **기존 테스트 변경 없음** + 새 테스트 3종(§3) |
| 6 회귀 확인 | 4조합 시각 확인 | 같음(ko/en × 라이트/다크) + ko 고정 전체 스위트 |

PR 나누기 제안. 각 PR에 en 스모크가 따라간다.
1. 인프라 + 메인 프로세스(메뉴·`role` 라벨·대화상자)
2. `index.html` 정적 마크업
3. 렌더러 JS 메시지 + 한글 리터럴 가드 테스트

앱 이름 수정은 독립적이라 이 셋보다 먼저 따로 내도 된다.

## 6. 위험
- **빠뜨린 문자열**: 영어 모드에 한국어가 섞여 남는다. §3의 한글 리터럴 가드 테스트가 막는다.
- **유지 비용**: 이후 모든 UI 문자열 추가에 두 언어가 필요하다. 테이블 일치성 테스트가 강제한다. 계획 12가 지적한
  "그냥 한 줄 추가가 안 된다"는 비용은 남는다.
- **번역 품질**: 자연스러움은 코드 조사로 담보되지 않는다. Ian이 검수한다.
- **동작 변화**: 한국어가 아닌 시스템의 기존 사용자 UI가 영어로 바뀐다. 릴리스 노트에 적는다.

## 7. 결정할 것
1. **착수 여부.**
2. ~~**언어 결정 방식**~~ — **결정(2026-10-12, Ian): 시스템 언어를 따른다**(앱 안 설정 없음).
3. ~~**ko·en 외 시스템 언어의 기본값**~~ — **결정(2026-10-12, Ian): 영어.**
4. **앱 이름 소문자 수정**을 먼저 별도로 낼지.
5. **`electronLanguages` 축소**를 포함할지.

## 8. 권장안의 성능·용량 실측 (2026-10-12)

develop(`f754d4e`, Electron 44.7.0)에서 `electron-builder --dir --mac`으로 빌드를 두 벌 만들어 비교했다.
기준 빌드와 `-c.electronLanguages=ko -c.electronLanguages=en` 빌드다. zip은 `ditto -c -k --keepParent`로 만들었다
(릴리스 zip과 같은 방식은 아니다).

**용량**

| 항목 | 기준 | ko·en만 | 차이 |
|---|---|---|---|
| 앱 번들 | 423.4MB | 384.2MB | **−39MB(−9%)** |
| 압축(zip, 사용자가 받는 크기) | 158.5MB | 146.2MB | **−12MB(−8%)** |
| Electron Framework 로캘 리소스 | 48.8MB | 1.2MB | −47.6MB |
| 앱 `Resources`의 `.lproj` | 55개 | 2개(`en`, `ko`) | |
| 문자열 테이블(추정) | — | 약 +10KB | 고유 UI 문자열 135개. 한국어 3.9KB는 옮겨 가는 것이라 순증가는 영어 약 4KB와 키·문법뿐이다 |

**실행 시점**(패키지 앱, Playwright로 실행해서 `#empty`가 뜰 때까지)

| 항목 | 기준 | ko·en만 |
|---|---|---|
| 기동 시간 5회 중앙값 | 560ms | 589ms — 잡음 범위. 두 빌드 모두 첫 실행 1회만 2.5~3.1초(콜드 스타트) |
| 시스템 언어 ko일 때 `app.getLocale()` | `ko` | `ko` |
| `-AppleLanguages '(en)'` | — | `en-US` |
| `-AppleLanguages '(ja)'` | `ja` | **`en-US`** — ja 리소스가 없어 Chromium이 영어로 떨어진다. "ko가 아니면 영어" 정책과 저절로 맞는다 |
| 영어 시작 시 정적 라벨 교체 비용(모의) | 0.7ms | 0.6ms — 한글이 든 텍스트 노드·`title`·`aria-label` **135곳**을 한 번에 바꾼 시간 |

정리하면, 권장안은 **성능 비용이 사실상 없고**(시작할 때 1ms 미만, 메뉴는 지금처럼 한 번만 만든다)
**용량은 늘지 않는다**. 문자열 테이블은 10KB 안팎이고, `electronLanguages`를 함께 넣으면 다운로드가 12MB 준다.

재현: `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --mac --publish=never -c.directories.output=<임시>`
(축소 빌드는 `-c.electronLanguages=ko -c.electronLanguages=en`을 더한다). 실행 측정은 `_electron.launch({ executablePath:
<MDV.app>/Contents/MacOS/MDV, args: ['-AppleLanguages', '(ja)'] })` 후 `app.getLocale()`. 라벨 교체 모의는 렌더러에서
`body *`의 텍스트 노드와 `title`·`aria-label`·`placeholder` 중 한글이 든 것을 바꾸며 `performance.now()`로 잰다.

## 계획 12와의 관계
계획 12의 권장(렌더러 점진 이관 → 메뉴 별도 트랙 → 런타임 전환)은 "여러 언어 + 실행 중 전환"을 전제로 한다. 이 범위에서는
이 문서가 그것을 대체한다. 계획 12는 그 전제가 필요해질 때의 참고로 남긴다.

## 재현 방법
- **문자열 집계**: `src/`의 `.js`·`.html`에서 `/* */`·`<!-- -->`·`//` 주석을 지운 뒤 한글
  (`[ㄱ-ㆎ가-힣]`)이 든 줄을 센다. 로그 분리는
  `grep -v '^\s*//' <file> | grep -E 'console\.(error|warn|log)' | grep -c '[가-힣]'`로 한다. 테스트는 `tests/**/*.js`에
  같은 방식을 쓴다.
- **로캘 프로브**: Playwright `_electron.launch({ args: [<repo>, '-AppleLanguages', '(en)'], env: { MDV_USER_DATA_DIR: <임시 폴더> } })`
  후 `app.evaluate(({ app }) => [app.getLocale(), app.getPreferredSystemLanguages()])`.
- **실제 메뉴 읽기**(설치된 앱, 손쉬운 사용 권한 필요):
  `osascript -e 'tell application "System Events" to tell process "MDV" to get name of menu items of menu 1 of menu bar item 4 of menu bar 1'`
  (`menu bar item` 2 = 앱 메뉴, 4 = 편집, 6 = 창).

## 출처
- Electron 문서 — `app.getLocale()`/`app.getPreferredSystemLanguages()`(macOS는 `[NSLocale preferredLanguages]`),
  메뉴 `role` 항목에서 macOS는 `label`·`accelerator`만 반영
- electron-builder 문서 — `electronLanguages`(유지할 Electron 로캘 목록, `en`은 `en-US`·`en-GB` 등을 모두 유지)
- [계획 12](./12-i18n-feasibility-assessment.md)
