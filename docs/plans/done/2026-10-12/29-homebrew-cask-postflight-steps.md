# 29. Homebrew cask의 `postflight` → `postflight_steps` 전환

## 상태
**완료(2026-10-12).** tap 커밋 `0047f85`(`oiysful/homebrew-tap`)로 반영했다. 아래 "결과"에 실측 기록이 있다.
계획 당시: v1.4.0 릴리스 뒤 `brew info --cask oiysful/tap/mdv`가
`Calling postflight is deprecated! Use postflight_steps instead.` 경고를 냈다. 동작에는 문제가 없었고,
옛 방식이 실제로 제거되기 전에 옮기는 것이 목표였다.

## 결과 (2026-10-12, Homebrew 7.0.9, 로컬 tap · `HOMEBREW_NO_AUTO_UPDATE=1`)
| 단계 | 결과 |
|---|---|
| 1 기준선(`postflight` 블록 삭제 후 reinstall) | `xattr -p com.apple.quarantine /Applications/MDV.app` → `0381;6acc4700;;342C6A61-…` — **속성이 남는다**. 이 단계는 여전히 필요하다 |
| 2 초안 그대로 `postflight_steps` + reinstall | `No such xattr: com.apple.quarantine`, `xattr -rl`로 앱 전체에서도 0건. `brew info`에 deprecated 경고 없음 |
| 3 실행 | `open` 후 MDV 프로세스가 떴다. 종료 후 다음 단계로 |
| 4 정적 점검 | `brew style` no offenses, `brew audit --cask --strict` 종료 코드 0 |
| 5 제거·재설치 | `brew uninstall --cask`로 `/Applications/MDV.app` 제거됨. 다시 `install`해도 속성 없음 |
| 3절 2 `sed` | `^  version "`·`^  sha256 "`가 새 파일에서 각각 정확히 1줄 |

샌드박스·App Management 우려(6번 대안 `writable_paths`)는 나타나지 않아 쓰지 않았다. 반영 방식은
tap의 GitHub 파일을 `gh api -X PUT`으로 커밋한 뒤 로컬 tap을 `checkout --` + `pull`로 맞췄다.

## 무엇을 바꾸나

`oiysful/homebrew-tap`의 `Casks/mdv.rb` 한 곳뿐이다. MDV 저장소에는 cask 사본이 없고,
`scripts/update-homebrew-tap.sh`는 `version`·`sha256` 두 줄만 `sed`로 바꾼다(아래 3절에서 영향 없음을 확인한다).

```ruby
# 지금
postflight do
  system_command "/usr/bin/xattr",
                 args: ["-dr", "com.apple.quarantine", "#{appdir}/MDV.app"],
                 sudo: false
end

# 바꿀 모양(초안 — 2절 검증 전)
postflight_steps do
  run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{appdir}}/MDV.app"]
end
```

이 단계가 하는 일은 그대로다. 받은 앱에 붙은 `com.apple.quarantine` 속성을 지워서, 서명·공증되지 않은 MDV를
Gatekeeper가 "손상됨"으로 막지 않게 한다. `caveats` 문구와 README의 설명도 바꿀 필요가 없다.

## 근거 — Homebrew 7.0.9 소스에서 확인한 것 (2026-10-12)

| 질문 | 답 | 위치 |
|---|---|---|
| 경고는 어디서 나오나 | 블록형 `preflight`/`postflight`/`uninstall_*`를 정의할 때마다 `odeprecated "`postflight`", "`postflight_steps`"` | `cask/dsl.rb` `ARTIFACT_BLOCK_CLASSES` |
| 언제부터 | `postflight_steps`는 2026-05-24 커밋 `6f0b2e25c4`로 들어와 **5.1.14**부터 있다. 공식 tap에서 옛 훅을 막는 커밋은 2026-08-04 `9f3bf077be` | `git -C $(brew --repository) log` |
| 새 방식은 무엇인가 | 임의의 Ruby 블록 대신 정해진 단계(`run`, `set_permissions`, `remove`…)를 나열하는 선언형 DSL | `install_steps.rb` |
| `/Applications/MDV.app` 경로를 넘길 수 있나 | 있다. `run`의 `args`는 `expand_template_tokens`를 거치고, `appdir`가 `CONTENT_PATH_TOKENS`에 있어 `{{appdir}}`로 쓴다 | `install_steps.rb` `run_serialised_command`, `template_token_value` |
| 기본 경로 기준 | 블록형 `*_steps`는 `default_base: :staged_path`. 그래서 `chdir`나 상대 경로는 `/Applications`가 아니라 스테이징 폴더를 가리킨다 → **절대 경로 템플릿을 써야 한다** | `cask/dsl.rb` `INSTALL_STEP_ARTIFACT_CLASSES` |
| 샌드박스에서 `/Applications`를 쓸 수 있나 | 샌드박스가 켜지면 `caskroom_path`와 `appdir`에 쓰기 허용을 더한다 | `cask/artifact/install_steps.rb` `run_steps` |
| 실제 사용 예 | 공식 `Casks/p/pd.rb`: `set_permissions "Pd-{{version}}.app", "u+w", base: :appdir` | homebrew-cask |

**아직 확인하지 못한 것** — 2절에서 실측으로 가른다.
1. 샌드박스 안에서 `xattr -d`가 실제로 허용되는가. 확장 속성 삭제가 샌드박스 프로필의 "쓰기"에 포함되는지는 소스만으로 판단하지 않는다.
2. macOS의 App Management 권한(Ventura+)이 터미널에 없을 때도 `/Applications/MDV.app`의 속성을 지울 수 있는가.
   지금의 `postflight`는 샌드박스 밖에서 같은 명령을 돌리고 있으니, 차이가 생긴다면 샌드박스 쪽이다.

## 1. 위험

- **구버전 Homebrew**: `postflight_steps`를 모르는 brew(5.1.14 이전)는 이 cask를 읽지 못한다. 다만 `brew install`·`brew upgrade`는
  기본적으로 먼저 `brew update`를 돌려 brew 자체를 올린 뒤 cask를 읽는다. 그래서 실제로 걸리는 경우는 `HOMEBREW_NO_AUTO_UPDATE`를
  켜고 5월 이전 brew를 쓰는 사용자뿐이다. 받아들일 수 있는 수준으로 보되, 커밋 메시지에 남긴다.
- **조용한 실패**: 단계가 실패하지 않고 아무 일도 안 하면(예: 경로가 스테이징 폴더를 가리킴), 설치는 성공하는데 앱이 "손상됨"으로 열리지 않는다.
  사용자가 처음 보게 되는 증상이 이것이다. 그래서 2절은 "설치 성공"이 아니라 **속성이 실제로 사라졌는지**로 판정한다.
- **기존 설치자에게는 영향 없음**: cask 변경은 다음 설치·업그레이드 때만 적용된다. MDV 릴리스도 필요 없다.

## 2. 검증 — 조건을 강제해서 가른다

메모리 `mdv-verify-repro-conditions`의 규칙대로, "새 단계가 무언가를 했다"를 보이려면 **단계 없이는 속성이 남는다**는 것부터 확인한다.

1. **기준선**: 로컬 tap(`/opt/homebrew/Library/Taps/oiysful/homebrew-tap`)에서 `postflight` 블록을 통째로 지운 상태로
   `brew reinstall --cask oiysful/tap/mdv` → `xattr -p com.apple.quarantine /Applications/MDV.app`가 **값을 출력해야 한다**.
   출력이 없으면 Homebrew가 이미 다른 경로로 quarantine을 지우는 것이고, 그렇다면 이 단계 자체가 불필요하다는 뜻이므로 계획을 다시 쓴다.
2. **새 단계**: 초안의 `postflight_steps`로 바꾸고 다시 `reinstall` → `xattr -p`가 **"No such xattr"** 로 실패해야 한다.
   `brew info`에 `postflight` 경고가 없어야 한다.
3. **실행**: `open /Applications/MDV.app`가 Gatekeeper 경고 없이 뜬다.
4. **정적 점검**: `brew style --cask` 와 `brew audit --cask --strict oiysful/tap/mdv`.
5. **제거**: `brew uninstall --cask`가 그대로 동작한다(이 단계는 설치 쪽만 바꾸지만 확인은 한다).
6. 2번에서 샌드박스나 App Management 때문에 실패하면, 그 오류를 계획에 기록하고 대안을 고른다.
   후보는 `run`에 `writable_paths: ["MDV.app"], writable_base: :appdir`를 주는 것(샌드박스 쓰기 경로 명시)이고,
   그래도 안 되면 경고를 감수하고 블록형을 유지한다.

로컬 tap에서 검증하는 동안은 tap 저장소에 커밋하지 않는다. 끝나면 `git -C <tap> checkout -- Casks/mdv.rb`로 되돌린다.

## 3. 반영

1. `oiysful/homebrew-tap`에 커밋: `mdv: replace the deprecated postflight block with postflight_steps`.
   본문에 2절 결과(기준선에서 속성이 남았고 새 단계에서 사라졌다)와 Homebrew 5.1.14 이상 요구를 적는다.
2. `scripts/update-homebrew-tap.sh`의 `sed` 두 줄(`^  version "…"`, `^  sha256 "…"`)이 새 파일에서도 정확히 한 번씩 맞는지 확인한다.
   맞지 않으면 다음 릴리스의 tap 갱신이 "already up to date"로 조용히 건너뛴다.
3. MDV 저장소: RELEASING(.ko).md 상자의 `postflight` 문장을 지우고, 메모리 `mdv-homebrew-distribution`을 갱신한다.

## 범위 밖
- 서명·공증. 그게 되면 quarantine 제거 단계 자체가 필요 없어진다(보안 감사 Next Steps 2번).
- 공식 homebrew-cask 등록.
