const test = require('node:test')
const assert = require('node:assert/strict')

const { createThemeController } = require('../../src/renderer/theme.js')

// theme.js injects matchMedia/storage/documentRef/getRefs/onThemeApplied, so the whole
// controller runs on plain objects -- no jsdom needed at this layer.
//
// The stubs record calls rather than only holding final values because several behaviours
// pinned below are *absences*: handleSystemThemeChange must not re-apply outside 'auto', and
// getIsDark must not touch the DOM at all. Re-applying 'dark' writes the same data-theme
// value it already had, so a final-value assertion cannot tell a skipped write from a
// redundant one -- only a call recorder can.
function createStubs({ stored = null, systemDark = false, withRefs = true } = {}) {
  const calls = { setAttribute: [], applied: [], setItem: [] }

  // `null` is a sentinel no theme ever writes (applyCodeTheme only writes booleans), so a
  // still-null flag proves nothing touched the stylesheet.
  const hlDark = { disabled: null }
  const hlLight = { disabled: null }

  const documentRef = {
    documentElement: {
      setAttribute(name, value) {
        calls.setAttribute.push([name, value])
      },
    },
    getElementById(id) {
      if (id === 'hljs-dark') return hlDark
      if (id === 'hljs-light') return hlLight
      return null
    },
  }

  const refs = {
    icAuto: { style: { display: 'untouched' } },
    icMoon: { style: { display: 'untouched' } },
    icSun: { style: { display: 'untouched' } },
    btnTheme: {
      title: 'untouched',
      attrs: {},
      setAttribute(name, value) {
        this.attrs[name] = value
      },
    },
  }

  const matchMedia = { matches: systemDark }

  const controller = createThemeController({
    matchMedia,
    storage: {
      getItem: () => stored,
      setItem(key, value) {
        calls.setItem.push([key, value])
      },
    },
    documentRef,
    // app.js always passes getRefs, but theme.js:21 guards for its absence because the app
    // applies a theme before DOMContentLoaded has collected the refs.
    getRefs: withRefs ? () => refs : undefined,
    onThemeApplied: isDark => {
      calls.applied.push(isDark)
    },
  })

  return { controller, calls, hlDark, hlLight, refs, matchMedia }
}

function resetCalls(calls) {
  calls.setAttribute.length = 0
  calls.applied.length = 0
  calls.setItem.length = 0
}

function lastDataTheme(calls) {
  const writes = calls.setAttribute.filter(([name]) => name === 'data-theme')
  return writes.length ? writes[writes.length - 1][1] : null
}

test('the stored theme is honoured at construction; a missing one means auto', () => {
  assert.equal(createStubs({ stored: 'dark' }).controller.getTheme(), 'dark')
  assert.equal(createStubs({ stored: 'light' }).controller.getTheme(), 'light')
  assert.equal(createStubs({ stored: null }).controller.getTheme(), 'auto')
})

test('construction alone applies nothing -- the app owns the first applyTheme call', () => {
  // app.js constructs the controller at module scope and app-runtime.js:425 applies later, so
  // a constructor that eagerly applied would write the DOM before the refs exist.
  const { calls, hlDark, hlLight } = createStubs({ stored: 'dark' })

  assert.deepEqual(calls.setAttribute, [])
  assert.deepEqual(calls.applied, [])
  assert.equal(hlDark.disabled, null)
  assert.equal(hlLight.disabled, null)
})

test('applyTheme for light sets the attribute, hljs flags, sun icon, and labels', () => {
  const { controller, calls, hlDark, hlLight, refs } = createStubs({ stored: 'light' })

  assert.deepEqual(controller.applyTheme(), { theme: 'light', isDark: false })
  assert.equal(lastDataTheme(calls), 'light')
  assert.equal(hlDark.disabled, true)
  assert.equal(hlLight.disabled, false)
  assert.equal(refs.icAuto.style.display, 'none')
  assert.equal(refs.icMoon.style.display, 'none')
  assert.equal(refs.icSun.style.display, '')
  assert.equal(refs.btnTheme.title, '밝게')
  assert.equal(refs.btnTheme.attrs['aria-label'], '밝게')
})

test('applyTheme for dark sets the attribute, hljs flags, moon icon, and labels', () => {
  const { controller, calls, hlDark, hlLight, refs } = createStubs({ stored: 'dark' })

  assert.deepEqual(controller.applyTheme(), { theme: 'dark', isDark: true })
  assert.equal(lastDataTheme(calls), 'dark')
  assert.equal(hlDark.disabled, false)
  assert.equal(hlLight.disabled, true)
  assert.equal(refs.icAuto.style.display, 'none')
  assert.equal(refs.icMoon.style.display, '')
  assert.equal(refs.icSun.style.display, 'none')
  assert.equal(refs.btnTheme.title, '어둡게')
  assert.equal(refs.btnTheme.attrs['aria-label'], '어둡게')
})

test('applyTheme for auto shows the auto icon regardless of which palette the system picks', () => {
  // 'auto' is the only theme whose icon/label does not follow the resolved palette: the button
  // must keep saying "system" while data-theme swings with the OS setting.
  const { controller, calls, refs, matchMedia } = createStubs({ stored: null, systemDark: true })

  assert.deepEqual(controller.applyTheme(), { theme: 'auto', isDark: true })
  assert.equal(lastDataTheme(calls), 'dark')
  assert.equal(refs.icAuto.style.display, '')
  assert.equal(refs.icMoon.style.display, 'none')
  assert.equal(refs.icSun.style.display, 'none')
  assert.equal(refs.btnTheme.title, '시스템 테마')
  assert.equal(refs.btnTheme.attrs['aria-label'], '시스템 테마')

  matchMedia.matches = false
  controller.applyTheme()
  assert.equal(lastDataTheme(calls), 'light')
  assert.equal(refs.icAuto.style.display, '')
  assert.equal(refs.btnTheme.title, '시스템 테마')
})

test('auto reads matchMedia.matches live, in both directions', () => {
  // The stub is mutated after construction on purpose: matches is read at call time, not
  // captured once, so a controller built while the OS was light must still go dark later.
  const { controller, calls, hlDark, hlLight, matchMedia } = createStubs({ stored: 'auto', systemDark: false })

  assert.deepEqual(controller.applyTheme(), { theme: 'auto', isDark: false })
  assert.equal(lastDataTheme(calls), 'light')
  assert.equal(hlLight.disabled, false)
  assert.equal(controller.getIsDark(), false)

  matchMedia.matches = true
  assert.deepEqual(controller.applyTheme(), { theme: 'auto', isDark: true })
  assert.equal(lastDataTheme(calls), 'dark')
  assert.equal(hlDark.disabled, false)
  assert.equal(controller.getIsDark(), true)

  matchMedia.matches = false
  assert.deepEqual(controller.applyTheme(), { theme: 'auto', isDark: false })
  assert.equal(lastDataTheme(calls), 'light')
  assert.equal(controller.getIsDark(), false)
})

test('an explicit theme ignores matchMedia entirely', () => {
  const light = createStubs({ stored: 'light', systemDark: true })
  assert.deepEqual(light.controller.applyTheme(), { theme: 'light', isDark: false })
  assert.equal(light.controller.getIsDark(), false)

  const dark = createStubs({ stored: 'dark', systemDark: false })
  assert.deepEqual(dark.controller.applyTheme(), { theme: 'dark', isDark: true })
  assert.equal(dark.controller.getIsDark(), true)
})

test('toggleTheme cycles auto -> light -> dark -> auto and persists every step', () => {
  const { controller, calls } = createStubs({ stored: null, systemDark: true })

  assert.deepEqual(controller.toggleTheme(), { theme: 'light', isDark: false })
  assert.deepEqual(controller.toggleTheme(), { theme: 'dark', isDark: true })
  // Back at auto the palette is the system's again, not the dark it just left.
  assert.deepEqual(controller.toggleTheme(), { theme: 'auto', isDark: true })
  assert.equal(controller.getTheme(), 'auto')

  // Ordered, one write per step: the setting has to survive a restart at every point in the
  // cycle, including the return to 'auto' (writing nothing there would restore 'dark').
  assert.deepEqual(calls.setItem, [
    ['theme', 'light'],
    ['theme', 'dark'],
    ['theme', 'auto'],
  ])
})

test('toggleTheme applies the new theme as it stores it', () => {
  const { controller, calls, hlDark, hlLight, refs } = createStubs({ stored: 'auto', systemDark: false })

  controller.toggleTheme()
  assert.equal(lastDataTheme(calls), 'light')
  assert.equal(refs.icSun.style.display, '')

  controller.toggleTheme()
  assert.equal(lastDataTheme(calls), 'dark')
  assert.equal(hlDark.disabled, false)
  assert.equal(hlLight.disabled, true)
  assert.equal(refs.icMoon.style.display, '')
  assert.deepEqual(calls.applied, [false, true])
})

test('handleSystemThemeChange re-applies while the theme is auto', () => {
  const { controller, calls, hlDark, matchMedia } = createStubs({ stored: 'auto', systemDark: false })

  controller.applyTheme()
  resetCalls(calls)

  matchMedia.matches = true
  controller.handleSystemThemeChange()

  assert.equal(lastDataTheme(calls), 'dark')
  assert.equal(hlDark.disabled, false)
  // mermaid bakes its palette in at draw time, so an OS flip has to reach the redraw callback.
  assert.deepEqual(calls.applied, [true])
})

test('handleSystemThemeChange does nothing once the theme is no longer auto', () => {
  // Asserted on the recorders, not on data-theme: re-applying 'dark' would write the same
  // attribute value, so only "no call happened at all" catches a dropped guard -- and a
  // spurious onThemeApplied would make mermaid redraw every diagram on an OS theme flip the
  // user explicitly overrode.
  const { controller, calls, hlDark, hlLight, matchMedia } = createStubs({ stored: 'dark', systemDark: false })

  controller.applyTheme()
  resetCalls(calls)
  const darkFlagAfterApply = hlDark.disabled
  const lightFlagAfterApply = hlLight.disabled

  matchMedia.matches = true
  controller.handleSystemThemeChange()
  matchMedia.matches = false
  controller.handleSystemThemeChange()

  assert.deepEqual(calls.setAttribute, [])
  assert.deepEqual(calls.applied, [])
  assert.equal(hlDark.disabled, darkFlagAfterApply)
  assert.equal(hlLight.disabled, lightFlagAfterApply)
  assert.equal(controller.getTheme(), 'dark')
})

test('onThemeApplied fires on the very first applyTheme, carrying isDark', () => {
  // theme.js:31-35: mermaid is lazy-loaded, and this first call is the app's one guaranteed
  // hand-off point for its initial theme. A "skip the redundant first redraw" optimisation
  // would silently take that away.
  const dark = createStubs({ stored: 'dark' })
  assert.deepEqual(dark.calls.applied, [])
  dark.controller.applyTheme()
  assert.deepEqual(dark.calls.applied, [true])

  const light = createStubs({ stored: 'light' })
  light.controller.applyTheme()
  assert.deepEqual(light.calls.applied, [false])

  const auto = createStubs({ stored: 'auto', systemDark: true })
  auto.controller.applyTheme()
  assert.deepEqual(auto.calls.applied, [true])
})

test('applyTheme still works with no getRefs injected', () => {
  // The app applies a theme before DOMContentLoaded collects the refs, so a missing refs
  // object must not cost the attribute, the stylesheets, or the mermaid callback.
  const { controller, calls, hlDark, hlLight } = createStubs({ stored: 'dark', withRefs: false })

  assert.deepEqual(controller.applyTheme(), { theme: 'dark', isDark: true })
  assert.equal(lastDataTheme(calls), 'dark')
  assert.equal(hlDark.disabled, false)
  assert.equal(hlLight.disabled, true)
  assert.deepEqual(calls.applied, [true])
})

test('getIsDark is a pure read: no DOM write, no stored write, no onThemeApplied', () => {
  // This is the documented reason it exists apart from applyTheme, and app-runtime.js:233
  // calls it mid print/PDF job -- a side effect there would fight withPrintPalette's own
  // light-palette swap.
  const { controller, calls, hlDark, hlLight, refs, matchMedia } = createStubs({ stored: 'dark' })

  assert.equal(controller.getIsDark(), true)
  matchMedia.matches = true
  assert.equal(controller.getIsDark(), true)

  assert.deepEqual(calls.setAttribute, [])
  assert.deepEqual(calls.applied, [])
  assert.deepEqual(calls.setItem, [])
  assert.equal(hlDark.disabled, null)
  assert.equal(hlLight.disabled, null)
  assert.equal(refs.icAuto.style.display, 'untouched')
  assert.equal(refs.btnTheme.title, 'untouched')
})

test('applyCodeTheme swaps only the highlight stylesheets', () => {
  // withPrintPalette (app-runtime.js:229) forces the light hljs sheet for the duration of a
  // print/PDF job; if this also moved data-theme or the stored setting, printing from dark
  // mode would visibly flip the screen and could outlive the job.
  const { controller, calls, hlDark, hlLight, refs } = createStubs({ stored: 'dark' })

  controller.applyTheme()
  resetCalls(calls)

  controller.applyCodeTheme(false)
  assert.equal(hlDark.disabled, true)
  assert.equal(hlLight.disabled, false)
  assert.deepEqual(calls.setAttribute, [])
  assert.deepEqual(calls.setItem, [])
  assert.deepEqual(calls.applied, [])
  assert.equal(controller.getTheme(), 'dark')
  assert.equal(controller.getIsDark(), true)
  assert.equal(refs.icMoon.style.display, '')

  // ...and restores symmetrically, which is what the job's finally block relies on.
  controller.applyCodeTheme(true)
  assert.equal(hlDark.disabled, false)
  assert.equal(hlLight.disabled, true)
  assert.deepEqual(calls.setAttribute, [])
})

test('applyTheme tolerates missing hljs stylesheet elements', () => {
  // The two <link> ids live in index.html; theme.js:11-12 guards for their absence so a
  // stripped-down host document cannot break theming outright.
  const calls = []
  const controller = createThemeController({
    matchMedia: { matches: false },
    storage: { getItem: () => 'dark', setItem: () => {} },
    documentRef: {
      documentElement: { setAttribute: (name, value) => calls.push([name, value]) },
      getElementById: () => null,
    },
    getRefs: () => null,
    onThemeApplied: () => {},
  })

  assert.deepEqual(controller.applyTheme(), { theme: 'dark', isDark: true })
  assert.deepEqual(calls, [['data-theme', 'dark']])
})

// Issue #20: a stored value outside the three themes used to poison the cycle permanently.
// `toggleTheme`'s lookup returned `undefined`, storage coerced that to the string "undefined",
// and that is not a key either -- so the button stayed dead across restarts, with every icon
// hidden and `aria-label` literally "undefined". The arrival path is a downgrade from a build
// that shipped a fourth theme, which is exactly the case a whitelist has to cover.
test('an unrecognized stored theme falls back to auto instead of poisoning the cycle', () => {
  for (const stored of ['sepia', 'undefined', '', 'AUTO', '{}']) {
    const { controller, matchMedia } = createStubs({ stored, systemDark: true })
    assert.equal(controller.getTheme(), 'auto', `stored ${JSON.stringify(stored)} must normalize to auto`)
    // Falling back to auto is only right if auto then behaves like auto: it must follow the OS.
    assert.deepEqual(controller.applyTheme(), { theme: 'auto', isDark: true })
    matchMedia.matches = false
    assert.deepEqual(controller.applyTheme(), { theme: 'auto', isDark: false })
  }
})

test('the auto fallback is a real auto: its icon and label are the auto ones, not blank', () => {
  // The visible symptom of the bug was all three icons hidden and title/aria-label undefined,
  // so the fallback has to be asserted through the chrome, not only through getTheme().
  const { controller, refs } = createStubs({ stored: 'sepia' })

  controller.applyTheme()

  assert.equal(refs.icAuto.style.display, '')
  assert.equal(refs.icMoon.style.display, 'none')
  assert.equal(refs.icSun.style.display, 'none')
  assert.equal(refs.btnTheme.title, '시스템 테마')
  assert.equal(refs.btnTheme.attrs['aria-label'], '시스템 테마')
})

test('toggling from an unrecognized stored theme stores real themes, never "undefined"', () => {
  const { controller, calls } = createStubs({ stored: 'sepia' })

  assert.deepEqual(controller.toggleTheme(), { theme: 'light', isDark: false })
  assert.deepEqual(controller.toggleTheme(), { theme: 'dark', isDark: true })
  assert.deepEqual(controller.toggleTheme(), { theme: 'auto', isDark: false })

  // Every write is one of the three themes. Before the fix all three were the string
  // "undefined", which is what made the dead state survive a restart.
  assert.deepEqual(calls.setItem, [['theme', 'light'], ['theme', 'dark'], ['theme', 'auto']])
})
