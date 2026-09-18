# 19. 기본 앱 안내 포커스 플레이크 — 진단

## 상태
**진단 완료, 수정 미착수** — 2026-09-18 작성.

계획 18(Electron CI 플레이크 2건) 작업 중 전체 스위트 병렬 실행에서 **세 번째** 실패가 나왔다.
계획 18의 두 건과는 성격이 다르다: 이건 **로컬 병렬 실행에서도 터진다**(3회 중 1회).
Ian의 결정으로 진단만 남기고 수정은 이 계획서로 미룬다.

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

## 수정 방향 (미착수)

숫자를 키우는 것(400 → 2000)은 **같은 오진의 반복**이다. 빈도만 낮추고 원인은 그대로다.
계획 18이 동시성 튜닝에 대해 내린 결론과 정확히 같은 이유로 하지 않는다.

창을 **테스트가 닫을 수 있게** 만들어야 한다. 방향은 두 가지다.

1. **응답을 테스트가 풀어준다.** 스텁이 타이머 대신 게이트에서 대기하게 하고, 테스트가
   `btn-theme.focus()`를 끝낸 뒤 명시적으로 게이트를 연다. 창의 길이가 러너 속도와 무관해진다.
2. **심는 순서를 뒤집는다.** 리로드 전에 포커스를 심을 수 있다면 지연 자체가 필요 없다.
   다만 리로드가 포커스를 날리므로 성립하는지 먼저 확인해야 한다.

1번이 `smoke-helpers.js`의 arm/wait 선례와 결이 같고, 계획 18에서 토스트에 적용한 것과 같은
"관측 창을 없앤다"는 원칙을 따른다.

## 하지 않을 것

- **`--test-concurrency` 재조정.** 이 저장소에서 이 진단은 이미 두 번 틀렸다.
- **지연 시간 증가.** 위와 같은 이유.
