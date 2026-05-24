# Assets

v0.5 시리즈에서 사용하는 이미지 자산. v0.5-a는 맵 베이스만 활용.

## 파일 구조

```
assets/
  maps/
    taiwan_strategic_map.png      ← v0.5-a (현재 사용)
  tokens/
    china_landing_craft.png       ← v0.5-b
    china_blockade_fleet.png      ← v0.5-b
    us_carrier_group.png          ← v0.5-b
    japan_patrol_aircraft.png     ← v0.5-b
    taiwan_defense_emplacement.png ← v0.5-b
  effects/                        ← v0.5-c (현재 없음)
  cards/                          ← v0.5-d (현재 없음)
  results/                        ← v0.5-e (현재 없음)
  marketing/                      ← v0.5-e (현재 없음)
```

## 생성된 자산 → 파일명 매핑

| 생성된 파일 | 배치 위치 |
|---|---|
| 타이완의_전략_지도.png | `assets/maps/taiwan_strategic_map.png` |
| 군사_상륙선_아이콘.png | `assets/tokens/china_landing_craft.png` |
| 현대_전함_함대_아이콘.png | `assets/tokens/china_blockade_fleet.png` |
| 군함_집합체_ui_아이콘.png | `assets/tokens/us_carrier_group.png` |
| 군용_항공기_아이콘.png | `assets/tokens/japan_patrol_aircraft.png` |
| 해안_요새_방어_기지.png | `assets/tokens/taiwan_defense_emplacement.png` |
| 미래적_게임_ui_아이콘_세트.png | `assets/effects/missile_effect_sheet.png` |
| 미래형_군사_전략_ui_디자인.png | `assets/cards/card_frame_sheet.png` |
| 전략적_전투_등급_카드_디자인.png | `assets/results/grade_background_sheet.png` |
| 해협의_72시간_전략_지도.png | `assets/marketing/strait72_hero_keyart.png` |

## v0.5-a 자산화 체크리스트

`assets/maps/taiwan_strategic_map.png`:
- [ ] 16:9 비율 권장 (예: 1920x1080 / 1600x900)
- [ ] PNG, 1MB 이내 권장 (>2MB면 로드 지연)
- [ ] 거점 위치가 코드의 PROVINCE_LAYOUT 정규화 좌표와 일치
- [ ] 화롄 라벨은 코드에서 얹으므로 이미지에 없어도 OK

## v0.5-b 진입 전 자산화 체크

토큰 PNG들 (`assets/tokens/*.png`):
- [ ] 배경 투명 (alpha channel)
- [ ] checkerboard 패턴이 박혀 있지 않은지 확인
- [ ] 256x256 또는 512x512 정사각 권장
- [ ] 파일당 200KB 이내
