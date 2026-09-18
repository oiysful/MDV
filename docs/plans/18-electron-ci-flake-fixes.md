# 18. CI 전용 Electron 플레이크 2건 수정

## 상태
**계획 (미착수)** — 2026-09-18 작성.

PR #8의 첫 실행(run `35202862668`)에서 Electron 스모크 104건 중 2건이 실패했고, 같은 커밋을
그대로 재실행하니 통과했다. 두 건 모두 **로컬에서는 재현되지 않는다.**

이 계획서의 핵심은 수정안 자체가 아니라 **진단이 바뀌었다**는 점이다. `ci-electron.yml`의
`--test-concurrency` 주석은 이 두 건을 "GitHub 러너의 코어 부족으로 인한 CPU 경합"으로 서술하고
동시성을 4→2로 낮춘 것을 대응으로 기록해 두었다. 그 서술은 틀렸다. 동시성 2에서도 재발했고,
아래에서 보듯 **둘 다 코드로 특정 가능한 테스트 설계 결함**이다. 동시성은 빈도만 바꿨다.

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
    record()                                   // 이미 떠 있는 경우도 놓치지 않는다
    new MutationObserver(record).observe(toast, { attributes: true, attributeFilter: ['class'] })
  })
}

async function waitForToast(page, pattern) {
  // RegExp는 페이지 경계를 넘지 못하므로 source만 넘긴다.
  await page.waitForFunction(
    source => (window.__mdvToasts || []).some(text => new RegExp(source).test(text)),
    pattern.source,
  )
}
```

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
// 스크롤 복원은 렌더 뒤에 적용된다. 렌더만 기다리면 restoreTabState가 scrollTop을
// 다시 넣기 전 값을 읽는다.
try {
  await page.waitForFunction(() => {
    const heading = document.querySelector('#content h1')
    const editor = document.getElementById('source-editor')
    const content = document.getElementById('content')
    const source = document.getElementById('source-view')
    return document.title === 'a'
      && heading && heading.textContent.includes('A edited')
      && editor.value.startsWith('# A edited')
      && content.scrollTop > 0 && source.scrollTop > 0
  })
} catch {
  // 의도적으로 삼킨다 — 아래 assert가 실제 값을 담은 메시지로 실패하게 두기 위해서다.
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
| `AGENTS.md` | 수정 후 NOTES의 플레이크 항목 갱신 — "재실행부터 해보라"는 현재 안내는 수정이 들어가면 더 이상 맞지 않는다 |

프로덕션 코드는 건드리지 않는다. 두 건 모두 앱의 결함이 아니라 테스트의 결함이다.

## 검증 계획과 그 한계

**정직하게 적어 둔다: 이 수정은 "고쳤음"을 결정적으로 증명할 수 없다.** 로컬에서 재현되지 않기
때문이다. 근거는 두 층이다.

1. **논리적 근거.** A는 관측 창 자체를 없애므로 근거가 강하다 — 타이밍과 무관해진다.
   B는 대기 조건이 검증 대상을 포함하게 되므로 이전보다 명백히 낫지만, "복원이 영원히 안 되는"
   경우와 "느린" 경우를 여전히 구분하지 못한다. 근거가 상대적으로 약하다.
2. **통계적 근거.** CI를 반복 실행해 연속 그린을 확인한다. 몇 회를 기준으로 할지는 착수 시
   정한다. 이건 증명이 아니라 신뢰 구간이다.

추가로, A는 **의도적으로 깨서** 검증할 수 있다: 토스트 타이머를 1600ms에서 아주 짧게 바꾸면
현재 테스트는 실패하고 수정된 테스트는 통과해야 한다. 이건 로컬에서 결정적으로 돌릴 수 있는
유일한 검증이므로 착수 시 먼저 한다.

## 하지 않을 것

- **동시성 재조정.** `--test-concurrency`를 또 만지는 것은 세 번째 오진이 된다. 진단이 바뀐 이상
  숫자는 이 문제와 무관하다. 속도 목적으로 올리는 것은 이 두 건이 실제로 고쳐진 뒤에 별건으로 본다.
- **프로덕션 코드 수정.** 토스트가 1600ms 뒤 사라지는 것은 올바른 UX다. 테스트가 그 사실에
  맞춰야지 그 반대가 아니다.
