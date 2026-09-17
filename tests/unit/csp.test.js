const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// CSP 고정 테스트. index.html의 CSP는 하드닝 결정의 저장소이고(docs/plans/done/2026-07-30/06-security-
// hardening-audit-2026-07-22.md), 문자열 하나라서 조용히 되돌아가기 쉽다. 이 테스트는
// 되돌림을 실패로 만들어 CSP 변경이 항상 의도적 갱신이 되도록 강제한다.
const HTML = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf-8')

function getCspContent() {
  const match = HTML.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)
  assert.ok(match, 'index.html must carry a Content-Security-Policy meta tag')
  return match[1]
}

// 지시어 단위로 쪼개서 해당 지시어의 소스 목록만 본다. (2026-09-17 이전에는 style-src와
// font-src가 https://fonts.googleapis.com / fonts.gstatic.com을 포함했고 이 헬퍼는 그래서
// 필요했다. 폰트를 번들로 옮기면서 원격 출처가 전부 사라졌지만, 지시어 단위 검사가 여전히
// 전체 문자열 비교보다 진단이 명확하므로 그대로 둔다.)
function getDirective(name) {
  const directive = getCspContent()
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .find(part => part.split(/\s+/)[0] === name)
  return directive ? directive.split(/\s+/).slice(1) : null
}

test('CSP img-src allows no remote origins — only self and data: URIs', () => {
  const sources = getDirective('img-src')
  assert.deepEqual(sources, ["'self'", 'data:'])
  // 로컬 이미지는 read-image-data-url을 통해 data: URI로만 들어온다. 원격 https를 허용하면
  // 신뢰할 수 없는 .md를 여는 것만으로 IP와 열람 시각이 유출된다.
  for (const source of sources) {
    assert.ok(!/^https?:/i.test(source), `img-src must not allow remote origin: ${source}`)
  }
})

test('CSP pins form-action, base-uri and object-src to none', () => {
  // DOMPurify는 <form action="https://evil.example">를 제거하지 않는다 — will-navigate
  // 가드 하나에만 의존하지 않도록 CSP에서도 막는다.
  assert.deepEqual(getDirective('form-action'), ["'none'"])
  assert.deepEqual(getDirective('base-uri'), ["'none'"])
  assert.deepEqual(getDirective('object-src'), ["'none'"])
})

test('CSP still allows no remote script origins', () => {
  assert.deepEqual(getDirective('script-src'), ["'self'"])
  assert.deepEqual(getDirective('default-src'), ["'self'"])
})

// 2026-09-17 감사 M2: 폰트를 Google에서 받아오던 동안은 style-src가 원격 출처를,
// font-src가 또 다른 원격 출처를 이고 있어야 했다. 폰트를 src/renderer/fonts/로 번들하면서
// 둘 다 'self'로 좁혔다 — 로컬 문서를 여는 것만으로 제3자에 접속하던 경로가 사라졌다.
// 편의를 이유로 원격 폰트를 다시 링크하면 CSP도 함께 열어야 하는데, 이 테스트가 그 되돌림을
// 실패로 만든다. 'unsafe-inline'은 남는다: 인라인 <style> 블록과 style= 속성을 앱 전반이
// 쓰고 있어, 제거하려면 nonce/hash 도입이라는 별개의 작업이 필요하다.
test('CSP keeps style and font sources local — no remote font CDN', () => {
  assert.deepEqual(getDirective('style-src'), ["'self'", "'unsafe-inline'"])
  assert.deepEqual(getDirective('font-src'), ["'self'"])
})

// CSP를 좁혀도 마크업에 원격 <link>가 남아 있으면 요청은 (차단된 채로) 여전히 나간다.
// 두 곳을 함께 잠가, 폰트가 실제로 번들에서만 온다는 것을 보장한다.
test('index.html requests nothing from a remote origin', () => {
  const remote = [...HTML.matchAll(/<link\b[^>]*>/gi)]
    .map(m => m[0])
    .filter(tag => /\b(href|imagesrcset)\s*=\s*["']https?:/i.test(tag))
  assert.deepEqual(remote, [], `index.html must not link remote resources:\n${remote.join('\n')}`)
  assert.ok(
    !/rel\s*=\s*["']preconnect["']/i.test(HTML),
    'a leftover preconnect still announces a third-party origin even if nothing loads from it'
  )
})
