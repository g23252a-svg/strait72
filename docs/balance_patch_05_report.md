# Strait 72 v0.2 balance_patch_05 report

## 목적

patch_04까지 중국 자살골 흐름은 해결됐지만, 중국 승리율이 0%로 고정됐다. 원인은 두 가지였다.

1. AI가 외교 축 또는 반복 축에 갇혀 대만의 정부/보급/사기를 충분히 압박하지 못했다.
2. 지룽/타오위안이 중국 통제에 들어가도 타이베이로 이어지는 내륙 압박 루트가 엔진에 없었다.

따라서 patch_05는 단순 수치 버프가 아니라 다음 세 가지를 동시에 적용한다.

- A. `suggestChinaAxis()` 다양화: 동일 주공축 반복 패널티, 외교축 보조화, 봉쇄/정보전 가치 재산정
- B. 중국 압박 효과 강화: 봉쇄/사이버/미사일 카드와 정보전/봉쇄 축의 대만 자원 압박 강화
- C-lite. 누락된 수도권 경로 구현: 지룽/타오위안 장악 후 타이베이 내륙 압박 가능

`C-lite`는 승리 조건 완화가 아니라 기존 기획의 "지룽/타오위안 → 타이베이" 인접 관계를 실제 엔진에 연결하는 패치다.

## 주요 변경

### target_selector.js

- `persistent.recentChinaAxes` 기반 동일축 반복 패널티 추가
- 외교 압박 축 기본점수 하향
- 동맹 게이지가 55 이상일 때만 외교축 가치 상승
- 봉쇄 축은 대만 보급이 높을 때도 가치가 생기도록 재설계
- 정보전 축은 대만 지휘/정부 기능이 멀쩡할수록 선제 압박 가치 상승

### state.js / turn_resolver.js

- `persistent.recentChinaAxes` 추가
- `phaseStrategyDeclaration()`에서 최근 중국 주공축 기록
- `checkVictoryConditions()`의 `turn >= totalTurns` 처리로 `no_outcome` 제거
- 수도권 교두보 + 정부 기능 약화 시 `china_capital_pressure_win` 추가

### combat_resolver.js

- `chooseAxisTarget()`에서 지룽/타오위안 중국 통제 후 north_pressure가 타이베이로 전환
- 가오슝/타이난 중국 통제 후 south_landing이 타이중으로 전환
- 인접 교두보가 완성된 내륙 목표에 공격 보정 추가
  - 타이베이 +5
  - 타이중 +3
- 인접 교두보가 뚫린 타이베이/타이중 방어 조직 약화 반영

### axes.json / cards_china.json

- `north_pressure`의 미국 개입 상승량 8 → 5
- `china_north_assault`의 미국 개입 상승량 4 → 3
- `naval_blockade` 축: 대만 보급 피해 8 → 10, 대만 사기 -2 추가
- `information_warfare` 축: 대만 지휘 피해 7 → 8, 대만 정부 피해 2 추가
- `china_naval_blockade_intensify`: 대만 보급 피해 10 → 14, 대만 사기 -2 추가
- `china_cyber_attack`: 대만 지휘 피해 8 → 10, 대만 정부 피해 3 → 6
- `china_missile_pressure`: 방어력 피해 2 → 3, 대만 사기 -3 → -4

### run_combat_smoke_test.mjs

- balance_patch_05 이후 기본 시나리오가 모두 성공할 수 있어 실패 경로 검증이 사라지는 문제 보완
- 별도 고방어/저자원 failure probe 추가

## 검증 결과

명령:

```bash
node src/validate_adjacency.mjs
node src/validate_cards.mjs
node src/validate_events.mjs
node src/run_combat_smoke_test.mjs
node src/run_target_smoke_test.mjs
node src/run_turn_smoke_test.mjs
node src/run_balance_sim.mjs --runs=50 --seed=42
```

결과:

```text
validate_adjacency ✅
validate_cards ✅
validate_events ✅
run_combat_smoke_test ✅
run_target_smoke_test ✅
run_turn_smoke_test ✅
run_balance_sim ✅
```

## 50회 밸런스 결과

```text
china_capital_pressure_win            19 / 50 = 38.0%
taiwan_survival_win                   29 / 50 = 58.0%
taiwan_political_collapse_win          2 / 50 =  4.0%

중국 승리 합계: 38.0%
대만 승리 합계: 62.0%
평균 종료 턴: 19.08
전투 성공률: 61.1%
```

## 해석

- 중국 승리율 0% 문제는 해소됐다.
- 목표 범위였던 중국 35~55%, 대만 45~65%에 최초 진입했다.
- 대만 정치압박 승리는 64%에서 4%로 크게 감소했다.
- 게임은 평균 19턴까지 진행되어 20턴 구조를 거의 끝까지 사용한다.
- 다만 전투 성공률 61.1%는 기존 목표 40~55%보다 높다.

## 다음 패치 후보

patch_06은 룰을 더 키우기보다, 전투 성공률만 55% 안쪽으로 내리는 미세 조정이 좋다.

추천:

1. 타이베이 인접 교두보 공격 보정 +5 → +4로 되돌리되, `china_capital_pressure_win`은 유지
2. 또는 대만 방어 중점 보너스 +2 → +3으로 상향
3. 또는 `global_bad_weather`의 weatherPenalty 2 유지하되, 상륙 관련 축에만 더 강하게 반영

현재는 최초로 승률 밴드가 맞았으므로 patch_05를 기준점으로 커밋하는 것을 추천한다.

## 커밋 메시지

```text
balance: patch 05 activate China win paths with AI diversity and capital pressure
```
