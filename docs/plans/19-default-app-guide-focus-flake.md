# 19. 기본 앱 안내 포커스 플레이크 — 진단

## 상태
**수정 완료** — 2026-09-18 진단, 같은 날 수정.

계획 18(Electron CI 플레이크 2건) 작업 중 전체 스위트 병렬 실행에서 **세 번째** 실패가 나왔다.
계획 18의 두 건과는 성격이 달랐다: 이건 **로컬 병렬 실행에서도 터졌다**(3회 중 1회).
진단만 먼저 남기고 수정은 별건으로 돌리기로 했었고, 이 문서가 그 별건이다.
프로덕션 코드는 건드리지 않는다 — 이번에도 앱이 아니라 테스트의 결함이었다.

## Context

| 테스트 | 위치 | 실패 |
|--------|------|------|
| default app guide has dialog semantics, traps Tab focus, and restores focus on ESC | `menu-and-guides.test.js:145` | `TimeoutError: page.waitForFunction: Timeout 15000ms exceeded` |

격리 실행은 1.1초에 통과하고 병렬 실행에서만 21초 타임아웃으로 죽는다. 실패 지점은 139~145행이다.

```js
await stubDefaultAppStatusDelay(electronApp, 400)   // 139행
await page.reload()                                  // 140행
await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
await page.evaluate(() => document.getElementById('btn-theme').focus())   // 142행
await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
await page.waitForFunction(() => document.activeElement?.id === 'default-app-do-not-show')  // 145행 ← 여기서 죽는다
```

## 진단 — 고정 길이 지연을 동기화 창으로 쓰고 있다

139행의 400ms는 대기가 아니라 **창**이다. 바로 위 주석이 그 의도를 적어두었다: 실제 IPC 왕복은
테스트가 끼어들 틈 없이 끝나므로, "모달 열리기 직전에 포커스가 있던 요소"를 심으려면 응답을
일부러 늦춰 틈을 만들어야 한다는 것이다. 즉 142행은 **그 400ms 안에 착지해야 한다.**

그런데 `src/renderer/onboarding.js`의 `openDefaultAppGuide`는 이렇게 동작한다.

```js
function openDefaultAppGuide(modal) {
  defaultAppGuideLastFocus = document.activeElement   // ← 이 시점의 포커스를 기억
  bindDefaultAppGuideFocusTrap(modal)
  modal.classList.add('show')
  requestAnimationFrame(() => {
    const focusable = getFocusableElements(modal)
    if (focusable.length) focusable[0].focus()        // ← default-app-do-not-show로 이동
  })
}
```

부하가 걸리면 `page.reload()` + `rendererReady` 대기 + `page.evaluate` 왕복이 **400ms를 넘는다.**
그러면 순서가 뒤집힌다:

1. 안내가 이미 열리고, 지연된 rAF가 `default-app-do-not-show`에 포커스를 준다
2. 그 **뒤에** 142행이 실행되어 포커스를 `btn-theme`으로 **빼앗는다**
3. 143행(`show` 클래스 확인)은 이미 만족되어 즉시 통과한다
4. 145행은 다시는 오지 않을 `activeElement === 'default-app-do-not-show'`를 15초 동안 기다린다

계획 18의 두 건과 같은 과(科)다 — **고정/암묵 지연을 명시적 조건 대신 쓴 것.** 다만 여기서는
사라지는 상태를 놓치는 게 아니라 테스트 자신이 검증 대상을 파괴한다.

### 결정적 재현

400ms를 1ms로 줄이면(= 창을 닫으면) 로컬에서 100% 재현된다.

```
✖ default app guide has dialog semantics, traps Tab focus, and restores focus on ESC (16337ms)
    at TestContext.<anonymous> (tests/electron/menu-and-guides.test.js:145:16) {
  name: 'TimeoutError'
}
```

병렬 실행의 실패와 줄 번호·예외 종류가 같다. 진단은 추정이 아니라 실증이다.

### 함께 깨지는 것

같은 뒤집힘에서 마지막 assert의 전제도 무너진다. `defaultAppGuideLastFocus`는 안내가 열리는
순간의 `document.activeElement`를 잡는데, 그 순간이 142행보다 앞서면 `btn-theme`이 아니라
그 이전 포커스가 저장된다. 145행이 먼저 죽어서 드러나지 않을 뿐, ESC 복원 assert
(`focus must return to the element focused before the modal opened`)도 같은 이유로 틀린 값을 본다.

## 수정 — 창을 테스트가 연다

숫자를 키우는 것(400 → 2000)은 **같은 오진의 반복**이다. 빈도만 낮추고 원인은 그대로 남는다.
계획 18이 동시성 튜닝에 대해 내린 결론과 정확히 같은 이유로 하지 않았다. 아래 검증이 그걸
숫자로 보여준다 — 검증에 쓴 지연이 2초라, 400을 2000으로 키웠어도 그대로 죽었을 것이다.
**고정 지연에는 항상 그것을 넘길 수 있는 부하가 있다. 게이트에는 넘길 숫자가 없다.**

`stubDefaultAppStatusDelay(electronApp, 400)`을 `stubDefaultAppStatusGate(electronApp)` +
`openDefaultAppStatusGate(electronApp)` 한 쌍으로 바꿨다. 스텁 핸들러는 타이머 대신 약속
하나를 기다리고, 테스트가 포커스를 심은 **뒤에** 그 약속을 푼다.

```js
await stubDefaultAppStatusGate(electronApp)
await page.reload()
await page.waitForFunction(() => document.documentElement.dataset.rendererReady === 'true')
await page.evaluate(() => document.getElementById('btn-theme').focus())
await openDefaultAppStatusGate(electronApp)   // ← 창은 여기서 열린다. 러너 속도와 무관하다.
await page.waitForFunction(() => document.getElementById('default-app-guide')?.classList.contains('show'))
```

안내가 심기보다 먼저 뜨는 것이 **구조적으로 불가능**해진다. 계획 18이 토스트에 적용한
"관측 창을 없앤다"와 같은 원칙이고, `smoke-helpers.js`의 arm/wait 선례와도 결이 같다.

### 무기한 대기가 안전한 이유

게이트를 영영 열지 않아도 교착은 없다. `app.js`가 `checkMarkdownDefaultAppStatus()`를
`void`로 던지고 **바로 다음 줄에서** `rendererReady`를 동기적으로 세우기 때문에, 막힌 상태
조회가 이 테스트가 기다리는 준비 신호를 붙들지 못한다. 바꾸기 전에 이 순서를 먼저 확인했다.

## 검증

수정 전 코드를 죽였던 조건을 그대로 재현해 양쪽을 돌렸다. 포커스를 심기 직전에
`waitForTimeout(2000)`을 넣어 "창을 놓친 느린 러너"를 만든다.

| | 결과 |
|---|---|
| 수정 **전** (`git show HEAD:`) + 2초 지연 | ✖ `TimeoutError` at `menu-and-guides.test.js:146`, 18243ms — CI 실패와 같은 모양 |
| 수정 **후** + 같은 2초 지연 | ✔ 통과, 2773ms |

즉 이 수정은 "테스트가 통과한다"가 아니라 **"터뜨리려고 만든 조건에서도 통과한다"**까지 보였다.
계획 18의 두 건과 같은 증거 수준이다.

통계적 확인도 붙인다. 이 건은 로컬 병렬 실행에서 **3회 중 1회** 꼴로 터졌었다. 수정 후
`--test-concurrency=2` 전체 스위트를 4회 돌려 **4회 모두 104/104**였다. 다만 무게는 위의
파괴 검증에 있다 — 4회 연속 그린은 1/3 빈도에 대해 그 자체로 결정적이지 않고, 결정적인 것은
실패를 만들어내는 조건이 더 이상 실패를 만들지 못한다는 쪽이다.

## 하지 않을 것

- **`--test-concurrency` 재조정.** 이 저장소에서 이 진단은 이미 두 번 틀렸다.
- **지연 시간 증가.** 위와 같은 이유.
