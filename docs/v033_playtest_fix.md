# Strait 72 v0.3.3 playtest fix

## 목적
v0.3.2 적용 확인 후 실제 30턴 플레이 로그에서 발견된 UI/엔진 불일치를 수정한다.

## 변경
- 로그 시간 표시에서 `Math.min(turn, 20)` 하드코딩 제거
  - T21~T30이 모두 `D+4 20:00`으로 찍히던 문제 수정
- `taiwan_survival_win` 라벨을 동적으로 표시
  - `대만 승리: 5일 생존` → `대만 승리: 30턴 / 7.5일 생존`
- 이미 `china_control`인 지역을 명시 타깃으로 반복 공격하지 않도록 차단
- 상륙/진척 계열 효과가 유효 지역 타깃을 못 찾으면 추상 전투를 굴리지 않음
  - `남부 상륙 성공: 전역/비접촉 영역` 같은 로그 방지
- `landingProgressBonus` 적용 시 이미 중국 통제 지역은 스킵
- 빌드 태그를 `v0.3.3`으로 갱신하고 캐시 버스터를 `?v=033-20260523`로 변경

## 검증
- node --check: playable_app.js, turn_resolver.js, target_selector.js, game_rules.js
- validate_adjacency / validate_cards / validate_events
- run_turn_smoke_test / run_target_smoke_test / run_combat_smoke_test
- run_balance_sim --runs=10 --seed=42
