# balance_patch_01: 대만 일방 승리 완화

## 진단 (baseline = seed42_runs50)

```
taiwan_political_collapse_win : 50/50 (100%)
avgFinalTurn                  : 17.8
combatSuccessRate             : 15.2%
chinaPoliticalPressure (avg)  : 100 (cap)
usIntervention (avg)          :   8.52
japanIntervention (avg)       :   6.8
koreaRearSupport (avg)        :  10 (시작값 고정)
```

## 근본 원인

1. **AI 편향**: `suggestChinaAxis`가 `diplomatic_pressure`를 매턴 선택 → 동맹 게이지 자살골
2. **자살골 페널티**: 작전 실패 시 `chinaPoliticalPressure +6~12`, `chinaSupply -6` 누적
3. **전투 성공률 15%**: 사기/지휘 만점 보너스가 너무 큼 (각 +2씩, 총 +4 방어 보정)
4. **한국 활성 불가**: 미국 60 이상 요구 → 디나이얼 압박에서 도달 불가능
5. **overdue 가중**: 13턴부터 매턴 +3, 누적 +24 (50% 기여)

## 적용 변경 (5개 파일)

### `data/axes.json`
- `north_pressure.riskOnFailure.chinaPoliticalPressure`: **10 → 6**
- `south_landing.riskOnFailure.chinaSupply`: **-6 → -3**
- `diplomatic_pressure.primaryEffects.usInterventionGainReduction`: **6 → 3**
- `diplomatic_pressure.primaryEffects.japanInterventionGainReduction`: **4 → 2**
- `information_warfare.primaryEffects.interventionGainReduction`: **5 → 3**

### `data/cards_china.json`
- `china_diplomatic_pivot.effects.usInterventionGainReduction`: **6 → 3**
- `china_diplomatic_pivot.effects.japanInterventionGainReduction`: **4 → 2**

### `src/combat_resolver.js`
- `moraleBandBonus`: 만점/하점 보너스 폭 **±2 → ±1** (방어 보정 둔감화)
- `commandBandBonus`: 동일하게 **±2 → ±1**
- 기준값 동일 (전체 -2~+2 폭 → -1~+1 폭)

### `src/turn_resolver.js`
- `phaseDamagePolitical` overdue 페널티: **+3 → +2**

### `data/events_global.json`
- `global_korea_nsc_rear_support.triggerWhen.metric usIntervention`: **gte 60 → gte 40**

### `src/target_selector.js`
- `suggestChinaAxis` 재가중:
  - `diplomatic_pressure` 기본값 5 → 3 (편향 완화)
  - `north_pressure` 기본값 5 → 6 + 외교 게이지 임박 시 보너스
  - `south_landing` 기본값 5 → 5.5
  - 게이지 최대치 가중치 0.1 → 0.05

## 목표 지표 (50회 시뮬 기준)

- 중국 승률: **35~55%**
- 대만 승률: **45~65%**
- combatSuccessRate: **40~60%**
- 평균 종료 턴: **12~17** (현재 17.8에서 약간 단축 가능)
- 한국 활성 이벤트: 시뮬 50회 중 **최소 5회 이상** 발동

---

## balance_patch_01 결과 (seed42_runs50, 적용 후)

```
taiwan_political_collapse_win : 50/50 (100%)  ← 여전히 100%
avgFinalTurn                  : 15.32        (17.8 → 15.32, 약간 빨라짐)
combatSuccessRate             : 24.2%        (15.2 → 24.2, 부족)
chinaPoliticalPressure (avg)  : 100 (cap)
usIntervention (avg)          : 36.64        (8.52 → 36.64, 큰 개선)
japanIntervention (avg)       : 25.76        (6.8 → 25.76)
koreaRearSupport (avg)        : 13.12        (10 → 13.12)
한국 NSC                       : 26%         (목표 5%↑ 달성)
미국 항모 이동                  : 6%
```

**평가**: 동맹 게이지 회복 됨. 자살골 부분 해결. **하지만 게이지가 임계값(50/45/40)을 못 넘어서 강력한 동맹 이벤트가 잠긴 채 정치압박만 누적되어 종료.**

## balance_patch_02 (추가 적용)

### `data/events_global.json` (임계값 -10~15)
- `global_us_carrier_movement.triggerWhen.usIntervention`: **50 → 35**
- `global_japan_security_council.triggerWhen.japanIntervention`: **45 → 30**
- `global_korea_nsc_rear_support.triggerWhen.usIntervention`: **40 → 30**
- `global_backchannel_ceasefire_offer`: usIntervention **70 → 50**, chinaPoliticalPressure **70 → 60**

### `src/turn_resolver.js`
- `phaseDamagePolitical`에 자연 회복: within phase일 때 `chinaPoliticalPressure -1/턴`
- overdue 페널티 `+2/턴` 유지

### `src/combat_resolver.js`
- 만점 사기/지휘 보너스 제거 (70+ 보너스만 유지):
  - `moraleBandBonus`: 85+→1, 70+→1, 55-→-1, 40-→-1 → 70+→1, 55-→-1 (4단계 → 2단계)
  - `commandBandBonus`: 동일

## 목표

- 중국 승률 30%↑
- combatSuccessRate 40%↑
- 항모 이동/안보회의 50% 이상 발동

---

## balance_patch_02 결과

```
taiwan_political_collapse_win : 50/50 (100%)  ← 여전히 100%
combatSuccessRate             : 23.8%        (24.2 → 23.8, 변화 없음)
미국 항모                       : 100% (목표 50%↑ 달성)
한국 NSC                       : 100% (목표 5%↑ 달성)
미국 개입도 (avg)               : 46 (36 → 46)
한국 후방지원 (avg)             : 22 (13 → 22)
```

**평가**: 이벤트 발동률은 완전히 정상화. 게이지 곡선도 우상향. **하지만 만점 보너스 제거는 전투 성공률에 거의 영향 없음 (±0.4%p)** → base defense를 직접 손대야 함.

이론치 검산:
- 평균 attack ≈ 11.3 + 2d6 = (13.3 ~ 23.3, avg 18.3)
- 평균 defense ≈ 16.5 (province)
- 차이 -1.2 → P(success) = P(2d6 >= 8.2) ≈ 28% (시뮬 24%와 일치)

## balance_patch_03 (전투 base 직접 수정)

### `src/combat_resolver.js`
- `effectiveProvinceDefense` base: **8 → 6** (-2)
- `abstractDefense` (정보전/외교전): **13 → 11** (-2)

예상 결과:
- 평균 defense → 14.5
- 차이 +0.8 → P(success) ≈ 60%

## 목표 재정의

- combatSuccessRate **40~55%**
- 중국 승률 **25%↑**

---

## balance_patch_03 결과

```
taiwan_political_collapse_win : 45/50 (90%)
no_outcome (= 대만 생존)        :  5/50 (10%)
combatSuccessRate             : 33.3% (24 → 33)
chinaPoliticalPressure (avg)  : 97.52
avgFinalTurn                  : 16.26
```

**평가**: defense -2가 전투 성공률 9%p 끌어올림 (예상치보다 낮음 — 평균 attack/defense 검산 결과 stage 진척이 거의 없어서 stage 패널티 효과가 시뮬되지 않음). 대만 생존 승리 케이스 5건 등장.

## balance_patch_04 (추가 적용)

### `src/combat_resolver.js`
- `effectiveProvinceDefense` base: **6 → 5** (-1, 한 단계 더)

### `src/turn_resolver.js`
- 자연 회복 (within phase): **-1/턴 → -2/턴**
- overdue 페널티: **+2/턴 → +1/턴**

## balance_patch_04 결과 ⭐ 현재

```
taiwan_political_collapse_win : 32/50 (64%)
no_outcome (= 대만 생존 승리)   : 18/50 (36%)
china_*                       :  0/50  (0%)   ← 중국 승률 0
combatSuccessRate             : 42.6% (목표 ✓)
chinaPoliticalPressure (avg)  : 81.6  (cap 탈출)
avgFinalTurn                  : 19.22
대만 정부 (avg)                : 98.12
대만 보급 (avg)                : 70.4
대만 사기 (avg)                : 79
```

**자살골 흐름은 완전히 해결됨.** 동맹 게이지, 전투 성공률, 정치압박 모두 정상 분포로 진입. 하지만 **중국 승리 경로 자체가 활성화되지 않음** — 대만 정부/보급/사기가 거의 깎이지 않아서 3개 중국 승리 조건이 모두 봉쇄됨.

## 잔여 이슈 분석

1. **AI 편향 잔존**: `suggestChinaAxis`가 여전히 외교 축에 머무는 경향. T5 이후 게이지가 거의 정적.
2. **봉쇄 축이 활용 안 됨**: `taiwanSupplyDamage 8` 효과가 있지만 AI가 봉쇄 축을 거의 선택 안 함.
3. **상륙 완주 불가**: 평균 attack vs strong defense (defenseValue 8인 capital 등) 차이로 inland_expansion까지 도달 못 함. 도시 함락 0건.
4. **승리 조건 비대칭**: 대만은 정치압박 100 하나만 채우면 됨. 중국은 3가지 조건 다 어려움.

## balance_patch_05 결과 (3시드 평균, runs=50)

| 지표 | seed=42 | seed=100 | seed=200 | 평균 | 목표 |
|---|---|---|---|---|---|
| 중국 승률 (capital_pressure) | 38% | 32% | 36% | **35.3%** | 35-55% ✓ |
| 대만 승률 (survival + collapse) | 62% | 68% | 64% | **64.7%** | 45-65% ✓ |
| 전투 성공률 | 61.1% | 58.9% | 60.5% | **60.2%** | 52-55% (5%p 초과) |
| 평균 종료 턴 | 19.08 | 19.26 | 18.84 | 19.06 | — |

**평가**: 승률 분포는 목표 밴드 안. 전투 성공률만 5%p 초과.

## balance_patch_06 시도 (4회) — 모두 실패

| 시도 | 변경 | 결과 |
|---|---|---|
| 06.1 | `defense base 5 → 6` + `abstractDefense 11 → 12` | 중국 16% (under-band), 전투 47.7% |
| 06.2 | `axis match bonus 2 → 1` | 효과 거의 없음 (38%/61% 유지) |
| 06.3 | `china_blitz_order.attackBonus 2 → 1` | 효과 없음 |
| 06.4 | `attack base 6 → 5` | 중국 14% (under-band), 전투 46% |

**학습**: 2d6 dice의 quantization 특성상, 단일 정수 변경은 (a) 너무 약하거나 (b) 너무 강한 두 극단만 가능. 평균 5%p의 미세 조정은 단일 변경으로 불가능.

**권장**: patch_05를 최종 상태로 commit. 전투 성공률 60%는 사용자 목표 55%보다 5%p 높지만 **승률 밴드는 정상**이라 게임성에 큰 영향 없음. 추가 미세 조정은 더 복잡한 변경(예: 다중 변경 조합, dice를 3d6으로 변경, attack/defense 양쪽에서 ±0.5 효과 시뮬)이 필요하며 이는 별도 패치로.

## 최종 커밋 권장

```
balance: patches 01-05 - rebalance combat, intervention thresholds, capital pressure path
```
