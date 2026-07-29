const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// CSP 고정 테스트. index.html의 CSP는 하드닝 결정의 저장소이고(docs/plans/06-security-
// hardening-audit-2026-07-22.md), 문자열 하나라서 조용히 되돌아가기 쉽다. 이 테스트는
// 되돌림을 실패로 만들어 CSP 변경이 항상 의도적 갱신이 되도록 강제한다.
const HTML = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf-8')

function getCspContent() {
  const match = HTML.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)
  assert.ok(match, 'index.html must carry a Content-Security-Policy meta tag')
  return match[1]
}

// 'style-src'/'font-src'는 정당하게 https://fonts... 를 포함하므로 전체 문자열 검사는
// 쓸 수 없다. 지시어 단위로 쪼개서 해당 지시어의 소스 목록만 본다.
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
