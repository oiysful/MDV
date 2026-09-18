# 18. CI 전용 Electron 플레이크 2건 수정

## 상태
**착수 — 항목별 상태는 아래와 같다.** 2026-09-18 작성, 같은 날 갱신.

| 항목 | 상태 |
|------|------|
| 설계 B — `split-view-async.test.js` | **적용 완료.** 로컬 결정적 재현으로 수정 전 실패 / 수정 후 통과까지 확인 |
| 설계 A — 헬퍼 (`smoke-helpers.js`의 `armToastWatch` / `waitForToast`) | **추가 완료** |
| 설계 A — 호출부 (`large-directory-watch.test.js`) | **적용 완료** |
| 설계 A — 의도적 파괴 검증 (토스트 타이머 단축) | **완료.** 창을 닫으면 수정 전 실패 / 수정 후 통과 확인 |
| 문서·주석 갱신 (`AGENTS.md`, `ci-electron.yml`, 이 문서) | **완료** |
| CI 3회 연속 그린 확인 | **충족.** PR #14, 커밋 `c443567`에서 3회 연속 성공 |

PR #8의 첫 실행(run `35202862668`)에서 Electron 스모크 104건 중 2건이 실패했고, 같은 커밋을
그대로 재실행하니 통과했다. **작성 시점에는** 두 건 모두 로컬에서 재현되지 않았다. 그 전제는
이후 B에 대해 깨졌다 — B는 로컬에서 결정적으로 재현됐다(아래 "검증 결과"). A는 여전히 자연
재현이 없지만, 관측 창 자체를 없애는 수정이라 재현 없이도 근거가 선다.

이 계획서의 핵심은 수정안 자체가 아니라 **진단이 바뀌었다**는 점이다. `ci-electron.yml`의
`--test-concurrency` 주석은 이 두 건을 "GitHub 러너의 코어 부족으로 인한 CPU 경합"으로 서술하고
동시성을 4→2로 낮춘 것을 대응으로 기록해 두었다. 그 서술은 틀렸다. 동시성 2에서도 재발했고,
아래에서 보듯 **둘 다 코드로 특정 가능한 테스트 설계 결함**이다. 동시성은 빈도만 바꿨다.
(그 주석 자체도 이 변경에서 현재 사실에 맞게 다시 썼다.)

## Context

실패 로그의 정확한 지점:

| # | 테스트 | 위치 | 실패 |
|---|--------|------|------|
| 44 | a pathologically large directory trips the path-count guard instead of hanging the app | `large-directory-watch.test.js:91` | `TimeoutError: page.waitForFunction: Timeout 15000ms exceeded` (`duration_ms: 18737`) |
| 86 | split view restores fresh preview and pane scroll after immediate tab switch | `split-view-async.test.js:86` | `AssertionError: preview scroll should restore, got 0` (`duration_ms: 9520`) |

## 진단 A — 1.6초짜리 관측 창

`large-directory-watch.test.js:91`은 토스트가 **보이는 중**인지를 폴링한다.

```js
await page.waitForFunction(() => document.getElementById('toast')?.classList.contains('show'))
```

그런데 `src/renderer/onboarding.js:40`에서 토스트는 스스로 사라진다.

```js
toastTimer = setTimeout(() => refs.toast.classList.remove('show'), 1600)
```

그리고 이 대기는 88행의 탐색기 트리 로딩 대기 **뒤에** 시작한다.

```js
await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('file-0.md'))  // 88행
await page.waitForFunction(() => document.getElementById('toast')?.classList.contains('show'))                // 91행
```

가드가 트립해 토스트가 뜨는 시점과 91행이 관측을 시작하는 시점 사이에 88행의 대기가 통째로 들어간다.
그 간격이 1600ms를 넘으면 토스트는 이미 꺼져 있고, 91행은 **다시는 오지 않을 클래스를 15초 동안
기다린다.** `duration_ms: 18737`이 정확히 그 모양이다(15초 타임아웃 + 앞선 대기).

부하가 클수록 88행이 길어지므로 CI에서만 터지는 것도 설명된다. 러너가 느려서가 아니라,
**테스트가 관측 창이 있는 상태를 창 밖에서 관측하기 때문**이다.

## 진단 B — 검증 대상이 대기 조건에 없음

`split-view-async.test.js:76-86`은 렌더 완료만 기다리고 스크롤을 읽는다.

```js
await page.waitForFunction(() => {
  const heading = document.querySelector('#content h1')
  const editor = document.getElementById('source-editor')
  return document.title === 'a' && heading && heading.textContent.includes('A edited')
    && editor.value.startsWith('# A edited')
})

const restoredScroll = await page.evaluate(() => ({ ... }))
assert.ok(restoredScroll.preview > 0, `preview scroll should restore, got ${restoredScroll.preview}`)
```

스크롤 복원은 렌더 **이후**에 적용된다. 대기 조건에 `scrollTop`이 없으므로, 본문은 있는데 아직
복원 전인 순간을 읽으면 0이 나온다. 이것도 부하가 커지면 그 틈이 벌어진다.

## 설계 A — 사라지는 상태를 폴링하지 말고 기록한다

저장소에 이미 같은 패턴의 선례가 있다(`smoke-helpers.js`의 `armSidebarTransitionWatch` /
`waitForSidebarTransition`). 같은 모양으로 토스트용 한 쌍을 추가한다.

```js
async function armToastWatch(page) {
  await page.evaluate(() => {
    window.__mdvToasts = []
    const toast = document.getElementById('toast')
    if (!toast) return
    const record = () => {
      if (toast.classList.contains('show')) window.__mdvToasts.push(toast.textContent)
    }
    record() // catches a toast that's already showing by the time this arms
    new MutationObserver(record).observe(toast, { attributes: true, attributeFilter: ['class'] })
  })
}

async function waitForToast(page, pattern, { timeout = 5000 } = {}) {
  try {
    await page.waitForFunction(
      ({ source, flags }) => (window.__mdvToasts || []).some(text => new RegExp(source, flags).test(text)),
      { source: pattern.source, flags: pattern.flags },
      { timeout },
    )
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error
  }
  const toasts = await page.evaluate(() => window.__mdvToasts ?? null)
  assert.ok(toasts, 'armToastWatch was never armed on this page -- ...')
  assert.ok(
    toasts.some(text => pattern.test(text)),
    `no recorded toast matched ${pattern}, got ${JSON.stringify(toasts)}`,
  )
}
```

**초안에서 두 군데가 바뀌었다.** 초안은 "첫 토스트가 기록될 때까지 기다린 뒤 Node에서 매칭한다"
였는데, 그러면 무관한 토스트가 먼저 뜨는 호출자가 정작 기다리던 토스트가 오기 전에 깨어나
실패한다. 그래서 대기 자체가 **패턴이 맞는** 토스트를 기다린다 — `RegExp`는 페이지 경계를 넘지
못하므로 `source`/`flags`를 넘겨 페이지 안에서 재구성한다.

그런데 대기만으로 끝내면 실패가 맨 `TimeoutError`가 되어 "어떤 토스트가 실제로 떴는지"를 잃는다.
그래서 설계 B와 **같은 수법**을 쓴다 — 타임아웃을 `try`/`catch`로 삼키고, 바로 아래 `assert`가
기록된 문구를 담아 실패하게 둔다. 삼키는 것은 타임아웃 **뿐**이다: 실행 컨텍스트 파괴나 타깃
종료까지 삼키면 전혀 다른 사고가 "no toast matched"로 둔갑한다.

`timeout` 기본값이 Playwright의 30초보다 한참 짧은 것도 같은 맥락이다: 뜰 토스트라면 트리거
직후에 뜨므로, 긴 기본값은 진짜 실패 경로를 느리게 만들 뿐이다. (실측: 이 대기의 실소요는 밀리초
단위다.)

테스트는 `emitRendererCommand('openFolder')` **전에** arm 하고, 트리 대기 뒤에 기록을 확인한다.

```js
await armToastWatch(page)
await stubOpenDialog(electronApp, [root])
await emitRendererCommand(electronApp, 'openFolder')
await page.waitForFunction(() => document.getElementById('explorer-tree').textContent.includes('file-0.md'))
await waitForToast(page, /너무 커서/)
```

관측 창이 사라지므로 러너 속도와 무관해진다. 토스트가 뜬 사실 자체가 남기 때문이다.

## 설계 B — 대기 조건을 검증 대상까지 넓힌다

단순히 assert를 대기로 바꾸면 실패 메시지가 `TimeoutError`가 되어 "실제 scrollTop이 얼마였는지"를
잃는다. 대기는 넓히되 실패 보고는 기존 assert에 맡긴다.

```js
// Scroll restore lands after the render, so waiting on content alone reads the pane
// before restoreTabState has written scrollTop back. Wait on the scroll too.
try {
  await page.waitForFunction(() => {
    const heading = document.querySelector('#content h1')
    const editor = document.getElementById('source-editor')
    const content = document.getElementById('content')
    const source = document.getElementById('source-view')
    return document.title === 'a' && heading && heading.textContent.includes('A edited')
      && editor.value.startsWith('# A edited')
      && content.scrollTop > 0 && source.scrollTop > 0
  }, undefined, { timeout: 5000 })
} catch {
  // Swallowed on purpose: let the asserts below fail with the real scrollTop values.
}
```

`catch {}`가 비어 있는 것은 실수가 아니라 설계다. 조건이 끝내 성립하지 않으면 바로 아래 두
`assert.ok`가 `got 0` 같은 실제 값을 담아 실패한다.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `tests/electron/helpers/smoke-helpers.js` | `armToastWatch` / `waitForToast` 추가 + export |
| `tests/electron/large-directory-watch.test.js` | 설계 A 적용 |
| `tests/electron/split-view-async.test.js` | 설계 B 적용 |
| `tests/electron/boot-and-render.test.js` | 남아 있던 같은 모양의 토스트 호출부 3곳을 같은 헬퍼로 이관 (아래 "남은 호출부 이관") |
| `AGENTS.md` | NOTES의 플레이크 항목 재작성 — 두 건이 각각 무엇이었고 어떻게 고쳤는지, B의 재현 조건, 그리고 이제 이 두 건이 빨간색이면 재실행이 아니라 **회귀**라는 점. "동시성을 낮춘 것은 해결이 아니었다"는 교훈은 유지 |
| `.github/workflows/ci-electron.yml` | `--test-concurrency` 주석 산문을 현재 사실에 맞게 갱신. **숫자는 2 그대로.** 이 계획서가 그 주석의 오진을 논지로 삼으면서 정작 변경 표에서 빠뜨렸던 파일이다 |
| `docs/plans/README.md` | 이 계획서의 색인 항목을 "착수 대기"에서 현재 상태로 갱신 |

프로덕션 코드는 건드리지 않는다. 두 건 모두 앱의 결함이 아니라 테스트의 결함이다.

## 남은 호출부 이관

설계 A가 헬퍼를 만들었지만 `large-directory-watch` 한 곳에서만 썼다. 검토 과정에서
`boot-and-render.test.js`에 **같은 모양의 호출부 3곳**(`코드 복사됨` / `복사됨` / `PDF 저장됨`)이
남아 있는 것이 드러났고, Ian의 결정으로 이번 변경에서 함께 이관했다. 헬퍼는 이미 있으므로
호출부만 바뀐다.

**다만 위험도 평가 하나는 정정해 둔다.** 검토는 `PDF 저장됨` 호출부를 "가장 위험"으로 봤다 —
토스트 폴링 앞에 최대 5000ms를 기다리는 `waitForFile`이 있으니 PDF 생성이 1.6초를 넘기면
토스트가 이미 꺼져 있다는 것이었다. **그 서술은 틀렸다.** `app-runtime.js#exportPdf`는
`await api.exportPdf(...)`가 **끝난 뒤에** `showToast('PDF 저장됨')`을 부른다. 즉 파일이 생긴
**다음에** 토스트가 뜨므로, `waitForFile`의 5초 예산은 토스트의 1.6초 수명을 잡아먹지 않는다.
실제로 토스트 타이머를 1ms로 줄인 파괴 조건에서 **이관 전 버전도 실패하지 않았다.**

그래서 이 이관은 "실증된 실패를 고쳤다"가 아니라 **구조적 의존을 없앴다**로 적는 것이 정확하다.
남은 창은 `waitForFile`의 100ms 폴링 간격 정도이고, 그것이 1.6초를 넘으려면 러너가 훨씬 심하게
굶주려야 한다. 없앨 수 있고 헬퍼가 이미 있으니 없앴을 뿐, 급한 불은 아니었다.

## 검증 결과

**작성 당시 이 절은 "이 수정은 고쳤음을 결정적으로 증명할 수 없다 — 로컬에서 재현되지 않기
때문"이라고 적혀 있었다. 그 전제는 B에 대해 깨졌다.** B는 로컬에서 결정적으로 재현됐고,
수정본이 같은 조건에서 통과하는 것까지 확인했다. 아래는 근거를 층위별로 구분해 다시 적은 것이다.

### B — 결정적 재현으로 확정 (근거: 실험)

두 조건이 **겹쳐야** 터진다. 하나만으로는 터지지 않는다.

1. **`fill()` 뒤 탭 전환이 `handleSourceInput`의 120ms 디바운스보다 느릴 것.** 느리면
   `renderSplitPreview`가 먼저 끝나 `tab.previewDirty = false`가 되고, 저장되는 `renderedHTML`
   스냅샷에 편집 결과가 담긴다. 복귀 시 `hydrateFromDom`이 그 스냅샷으로 본문을 **동기적으로**
   그리므로 (수정 전) 대기 조건이 **즉시** 만족된다 — 즉 관측 창이 열린다.
   로컬에서 안 터지던 이유가 여기 있다: 로컬은 클릭이 빨라 `previewDirty: true` 경로를 타는데,
   그 경로에서는 스크롤 복원이 비동기 렌더의 `.then()`에서 일어나 본문 등장과 마이크로태스크
   거리라 읽을 창이 아예 열리지 않는다.
2. **rAF가 굶주릴 것.** 스크롤 복원은 `restoreTabState`의 `requestAnimationFrame` 안에만 있어
   본문이 보인 뒤 한 프레임 늦게 온다. 부하 걸린 러너에서 rAF 지연이 CDP 왕복보다 길면
   `preview: 0`을 읽는다. 이때 `source`는 살아 있으므로 preview assert에서 먼저 죽는데,
   이는 CI가 86행에서 실패한 모습과 정확히 일치한다.

계측(`window.__mdvProbeLog`)은 이 순서를 그대로 보여줬다:
`{e:"restore", previewDirty:false, previewScrollTop:8384.5, hasHtml:true}` →
대기 조건 만족 시점 `{p:0, s:6006}` → 한 프레임 뒤 `{p:8385}`.

재현 절차 — 둘 다 필요하고, 둘 다 일시적 계측이라 트리에 남기지 않는다:

1. 테스트의 `.nth(1).click()` 직전에 `await page.waitForTimeout(500)` 삽입 (느린 클릭 시뮬레이션).
2. `src/renderer/workspace.js`의 `restoreTabState`에서
   `requestAnimationFrame(() => {...})` → `setTimeout(() => {...}, 300)` (rAF 굶기기).

결과는 `AssertionError: preview scroll should restore, got 0` — CI 메시지와 동일했다. 설계 B
적용본은 동일 조건에서 통과했다. 두 계측 모두 되돌렸고 `src/`는 이 브랜치에서 변경되지 않았다.

### 반증된 가설 — "저장측이 0을 저장한다" (근거: 실험)

`saveCurrentTabState`가 렌더 도중 `content.scrollTop`을 0으로 캡처한다는 가설은 **틀렸다.**
`refs.content.innerHTML = ...` 교체는 동기라 중간 레이아웃이 없고, 따라서 `scrollTop`이
클램프되지 않는다. `readImageDataUrl`에 900ms 지연을 주입해 렌더 await 창 한가운데서 탭을
전환해도 mid-render `scrollTop`은 8391이었고, 완전히 정착한 뒤에도 8393으로 정상 복원됐다.
→ "변경 파일" 절의 "프로덕션 코드는 건드리지 않는다"는 결론이 추론이 아니라 실험으로
뒷받침된다.

### A — 논리적 근거 + 의도적 파괴 검증 (근거: 논증 + 실험)

A는 관측 창 자체를 없애므로 타이밍과 무관해진다. 근거의 **성격**이 B와 다르다 — 자연 실패의
재현이 아니라, **창을 인위적으로 닫아** 같은 실패를 만들어내는 쪽이다. `onboarding.js`의 토스트
타이머 `1600`을 `1`로 줄인 뒤:

- 수정 **전** 테스트(`git show e5c92c5^:`로 꺼낸 원본 — `HEAD:`는 이제 수정본이라 거짓 음성이 난다)는
  계획서가 기록한 CI 실패와 같은 모양으로
  실패했다 — `page.waitForFunction: Timeout 15000ms exceeded` at `large-directory-watch.test.js:91`,
  `duration_ms: 15723`. (CI 로그는 `duration_ms: 18737`이었다. 15초 타임아웃 + 앞선 대기라는
  구조가 같다.)
- 수정 **후** 테스트는 같은 조건에서 통과했다(2/2).

50ms로는 재현되지 않았다 — 로컬이 너무 빨라 창이 여전히 열려 있었다. 창을 실제로 닫으려면
1ms가 필요했다. `src/renderer/onboarding.js`는 검증 후 원복했고 이 브랜치에서 변경되지 않았다.

**작성 시점의 평가가 뒤집혔다는 점을 남겨 둔다.** 원래 이 절은 A의 근거가 강하고 B가 약하다고
적었다. 지금은 둘 다 실험으로 뒷받침되지만 성격이 다르다 — B는 **자연 실패를 재현**했고,
A는 **창을 닫아** 실패를 만들어냈다. B 쪽이 더 무거운 증거다.

### 통계적 근거

CI를 반복 실행해 연속 그린을 확인하는 것은 여전히 할 일이지만, 성격이 달라졌다. B에 대해서는
이제 증명이 아니라 확인이다 — 증명은 위의 재현이 이미 했다. **기준은 CI 3회 연속 그린으로 둔다.**

로컬 전체 스위트를 `--test-concurrency=2`로 3회 돌린 결과는 104 / 104 / 103이었고, **이 두 건은
3회 모두 그린**이었다. 1회의 실패는 이 계획서 범위 밖의 다른 테스트
(`menu-and-guides.test.js`의 기본 앱 안내 포커스 테스트, 145행 `TimeoutError`)였다 — 같은 과의
결함이지만 별건으로 분리했고, 진단은 `docs/plans/19-default-app-guide-focus-flake.md`에 있다.

**CI 기준도 충족됐다.** PR #14의 커밋 `c443567`에 대해 `test-electron`을 3회 돌려
(최초 실행 + `gh run rerun` 2회 — 같은 커밋이어야 표본으로 의미가 있다) **3회 모두 성공**했다.
첫 실행은 4분 23초였다. 피처 브랜치 푸시만으로는 이 워크플로가 돌지 않으므로
(`push` 트리거가 `main`/`develop`만 받는다) 수집은 PR을 열어야 시작된다 — 푸시를 세 번 하면
서로 다른 커밋의 1회씩이 되어 표본이 되지 않는다.

## 하지 않을 것

- **동시성 재조정.** `--test-concurrency`를 또 만지는 것은 세 번째 오진이 된다. 진단이 바뀐 이상
  숫자는 이 문제와 무관하다. 속도 목적으로 올리는 것은 이 두 건이 실제로 고쳐진 뒤에 별건으로 본다.
- **프로덕션 코드 수정.** 토스트가 1600ms 뒤 사라지는 것은 올바른 UX다. 테스트가 그 사실에
  맞춰야지 그 반대가 아니다.
