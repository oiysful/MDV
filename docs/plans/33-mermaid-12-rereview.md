# 33. mermaid 11.17.2 → 12.3.0 재검토

## 상태
**재검토 완료 (2026-11-10, Ian 지시). 보류 사유는 풀렸다. 외관·레이아웃 결정만 남았다.** 앱 코드는 바꾸지 않았다.
측정용 **Draft PR #61**(`chore/mermaid-12`)은 MDV 설정을 그대로 두고 12의 기본값으로 렌더한다.
결정이 나면 그 설정과 아래 "착수 시 할 일"을 같은 PR에 더한다.

계획 25(`done/2026-10-02/25-dependency-upgrade-survey.md` §3)가 mermaid 12.0.0을 보류한 이유는 둘이었다.
첫째, `chevrotain ~11.1.2`가 취약한 `lodash-es` 4.17.23을 끌어와 override가 필요했다(→ 1절).
둘째, 기본 레이아웃·외관이 바뀌어 시각 검토가 필요했다(→ 3절).

## 1. 보류 사유 — 풀렸다
- **12.1.0(2026-10-02)이 chevrotain 13으로 올렸다**(#8330 "so mermaid no longer pulls in vulnerable `lodash-es@4.17.23`",
  #8333). 12.3.0은 `chevrotain ~13.2.0`이고, 13.2.0은 `lodash-es`에 의존하지 않는다.
- worktree에서 `npm i mermaid@12.3.0`(공개 2026-11-03, 쿨다운 지남)을 override 없이 깔았다. `npm audit`은
  high·critical 0이다. mermaid 경유 katex low(GHSA-238p-pmpm-9mq7)도 사라졌다. 남은 것은 electron-builder 빌드
  트리의 minimatch moderate 6건이고, develop과 같다.

## 2. 보안 — 열린 메모 두 개가 닫힌다
`memory-security.md`의 10-12·10-27 항목은 둘 다 "mermaid 12에 실려 간다"로 남아 있다. `mermaid.min.js` 안의 버전
문자열로 확인했다.

| 번들 안 | 11.17.2 | 12.3.0 |
|---|---|---|
| DOMPurify | 3.4.12 (3.4.16 이하 권고 범위) | **3.4.17** (12.3.0 #8661, GHSA-55q2-fjhq-7xh7 · GHSA-6688-9rhm-gjv2) |
| KaTeX | 0.16.47 (GHSA-238p, low) | **0.18.11** (0.18.2 이상이라 해당 없음) |

MDV 쪽 호출(`securityLevel: 'strict'`)은 그대로다.

**라이선스(참고)**: 12는 ELK를 `mermaid.min.js`에 넣는다(`org.eclipse.elk` 문자열 8곳). 12.3.0의 elkjs 0.12.0은
`EPL-2.0 OR GPL-3.0-or-later`다(#8532). `mermaid/dist`에는 ELK 라이선스 고지 파일이 없다. MDV(ISC)는 수정하지 않은
번들을 그대로 배포하는 쪽이다. 착수할 때 앱 안 고지(README 또는 About)가 필요한지 한 번 보기로 한다.

## 3. 외관·레이아웃 — 결정할 곳
12의 기본값은 레이아웃 ELK, 외관 `neo`다. MDV는 `theme`만 지정하므로(`markdown.js`의 `initMermaidTheme`)
색은 그대로이고 **배치와 모양이 바뀐다.**

**비교 페이지: https://claude.ai/artifact/F4vzd93g521JWMb6kYqEpE** — 9종을 네 가지로 렌더해 나란히 놓았다.
측정 조건은 다음과 같다. MDV와 같은 설정(`startOnLoad: false`, `securityLevel: 'strict'`, `theme: 'default'`),
Electron 44.9.3 숨긴 창, 호스트 폭 1060px, `mermaid.run()` 후 rAF 두 번 뒤의 SVG 크기와 실행 시간.

| 다이어그램 | 11.17.2 | 12 기본값 | 12 `look: 'classic'` | 12 `look: 'classic', layout: 'dagre'` |
|---|---|---|---|---|
| 플로차트(서브그래프) | 271×739 · 77ms | 240×797 · 169ms | 275×827 · 55ms | 334×808 · 34ms |
| 시퀀스 | 450×401 | 450×453 | **450×401** | **450×401** |
| 클래스 | 121×318 | 121×361 | 121×361 | **121×318** |
| 상태 | 181×348 | 238×398 | 238×398 | 233×348 |
| ER | 120×470 | 120×470 | 120×470 | 120×470 |
| 간트·파이·gitGraph | 같음 | 같음 | 같음 | 같음 |
| 마인드맵 | 317×404 | 319×413 | **319×413** | **431×247 (배치가 바뀜)** |

- **어느 설정도 11과 똑같이 돌아오지 않는다.** 12의 dagre 자체가 간격이 다르다. 계획 25에서도 같은 결론이었다.
- `layout: 'dagre'`를 전역에 걸면 **마인드맵까지 dagre로 배치돼 모양이 크게 바뀐다**(원래 cose-bilkent).
  호환을 고르려면 마인드맵을 위한 예외가 필요하다.
- `look: 'classic'`만 걸면 시퀀스·마인드맵은 11과 같아진다. 플로차트·클래스·상태는 ELK 배치가 남는다.
- 시간은 ELK 플로차트가 가장 느리다(169ms, 11은 77ms). 나머지는 비슷하다. mermaid는 지연 로딩이라
  다이어그램이 없는 문서에는 비용이 없다.

## 4. 크기
`electron-builder --dir`로 develop과 12.3.0 브랜치를 각각 실제 `npm ci` 한 worktree에서 패키징했다.
zip은 `ditto -c -k`로 만든 근사값이다.

| | develop (11.17.2) | 12.3.0 | 차이 |
|---|---|---|---|
| `mermaid.min.js` | 3.57MB | 5.54MB | +1.97MB |
| MDV.app | 386MB | 418MB | +32MB |
| app.asar | 133MB | 175MB | +42MB |
| zip | 145.3MB | 153.6MB | **+8.3MB** |

계획 25가 12.0.0으로 잰 값(+64MB, zip +15MB)의 절반 정도다. 그때와 기준선도 다르다
(10-12 `electronLanguages`로 ko·en만 남겨 zip이 12MB 줄었다).

## 5. 테스트
- unit 296/296, controller 13/13 (로컬). jsdom이라 mermaid를 실제로 그리지 않는다.
- CI Electron(PR #61, run 42761944936): **132/132 통과**(207.8초). mermaid 테스트 넷(렌더·테마 재그리기·스냅숏
  재사용, 소스 모드 왕복 후 크기, 인쇄 팔레트, 툴팁 스크롤)이 12 기본값으로 통과했다. CI는 `--disable-gpu`로 돈다.
- 계획 25 §3의 경고는 이번 통과로 사라지지 않는다. 한 번 통과한 것으로 대기 조건이 충분하다는 증거가 되지는 않는다. `boot-and-render.test.js`의 mermaid 테스트들은 `#content .mermaid svg`가
  생기기만 기다린 뒤 크기를 잰다(539·593·620·646행). ELK 렌더는 비동기라, SVG가 생긴 시점에 `viewBox`가
  아직 없을 수 있다. 착수할 때 이 대기를 MDV 자신의 완료 신호로 바꾼다.

## 6. 결정할 것
1. **착수 여부**: 보류 사유가 풀렸고 보안 메모 둘이 닫힌다. 비용은 zip +8MB와 다이어그램 모양 변화다.
2. **외관·레이아웃**:
   - (A) 12 기본값 그대로(ELK + neo)
   - (B) `look: 'classic'`만 걸기
   - (C) `look: 'classic', layout: 'dagre'`에 마인드맵 예외 두기
   - 비교 페이지를 보고 정한다.

## 착수 시 할 일
- 고른 설정을 `MERMAID_BASE_CONFIG`에 넣는다. (C)라면 마인드맵 예외를 어떻게 둘지 정한다.
- Electron mermaid 테스트의 대기를 렌더 완료 신호로 바꾼다(5절).
- `memory-security.md`의 mermaid 관련 두 메모를 닫고, ELK 라이선스 고지 필요 여부를 적는다.
- 릴리스 전 `install:local`로 다이어그램과 인쇄(PDF)를 직접 확인한다.

## 재현 방법
- 프로브: Electron 메인 스크립트 하나가 `show: false` 창 **하나**를 만든다. 각 변형마다 같은 빈 페이지를 다시
  `loadFile`하고 해당 `mermaid.min.js`를 `<script>`로 넣는다. 이어서 `mermaid.initialize({startOnLoad:false,
  securityLevel:'strict', theme:'default', ...변형})`과 `mermaid.run({nodes:[el]})`을 돌린다. rAF 두 번 뒤
  `svg.getBoundingClientRect()`를 읽고, `svg.outerHTML`의 id를 변형별로 바꿔 모은다.
- 함정 셋:
  - 변형마다 창을 새로 만들면 Claude Code의 Bash 샌드박스에서 두 번째 렌더러가
    `mach_port_rendezvous … Permission denied`로 죽는다(`ERR_FAILED`). 창 하나를 재사용한다.
  - 숨긴 창의 `capturePage()`는 낡은 프레임을 찍었다(마인드맵 칸에 gitGraph가 찍힘). 그래서 그림 대신 SVG 원본을 모았다.
  - 호스트가 `inline-block`이면 폭 지정이 없는 SVG가 300px로 줄어든다. 호스트 폭을 고정한다.
- 크기: develop과 브랜치를 각각 `git worktree add` 하고 실제 `npm ci --ignore-scripts`를 한다
  (`node_modules` 심볼릭 링크로는 electron-builder가 의존성을 빼먹는다). 그다음 `npx electron-builder --dir --publish never`
  → `du -sm MDV.app`, `ditto -c -k --keepParent`로 잰다.

## 출처
- mermaid 릴리스 노트 12.1.0·12.2.0·12.3.0: https://github.com/mermaid-js/mermaid/releases
- 계획 25 §3: [done/2026-10-02/25-dependency-upgrade-survey.md](./done/2026-10-02/25-dependency-upgrade-survey.md)
