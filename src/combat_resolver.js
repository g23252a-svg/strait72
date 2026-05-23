// =====================================================================
// 작전/전투 판정기 (combat_resolver.js)
// =====================================================================
// v0.2 목적:
//   - "효과 적용"과 "성공/실패 판정"을 분리한다.
//   - landingProgressBonusOnSuccess / supplyGainOnSuccess / riskOnFailure를
//     실제 판정 결과에 연결한다.
//   - 군사적으로 세밀한 시뮬레이션이 아니라, 보드게임식 추상 판정.
// =====================================================================

import { landingStageToControlStage, LANDING_STAGES } from "./landing_fsm.js";
import { computePersistentDefenseBonus } from "./reward_system.js";

export const SUCCESS_DEPENDENT_EFFECT_KEYS = Object.freeze([
  "landingProgressBonus",
  "landingProgressBonusOnSuccess",
  "supplyGainOnSuccess",
  "defenseValueDamage",
  "taiwanGovernmentDamage",
  "taiwanCommandDamage",
  "taiwanSupplyDamage"
]);

export const COMBAT_CARD_TYPES = Object.freeze([
  "attack",
  "ranged"
]);

export const AXIS_DEFAULT_TARGETS = Object.freeze({
  north_pressure: ["keelung", "taoyuan"],
  south_landing: ["kaohsiung", "tainan"],
  naval_blockade: ["strait"],
  information_warfare: [],
  diplomatic_pressure: []
});

export function roll2d6(randomFn = Math.random) {
  return 1 + Math.floor(randomFn() * 6) + 1 + Math.floor(randomFn() * 6);
}

export function isCombatRelevantSource(source) {
  if (!source) return false;
  if (COMBAT_CARD_TYPES.includes(source.type)) return true;
  const effects = source.primaryEffects || source.effects || {};
  return Object.keys(effects).some((key) => SUCCESS_DEPENDENT_EFFECT_KEYS.includes(key));
}

export function splitCombatEffects(effects = {}) {
  const successEffects = {};
  const immediateEffects = {};

  for (const [key, value] of Object.entries(effects)) {
    if (SUCCESS_DEPENDENT_EFFECT_KEYS.includes(key)) {
      successEffects[key] = value;
    } else {
      immediateEffects[key] = value;
    }
  }

  return { successEffects, immediateEffects };
}

export function chooseAxisTarget(state, axis) {
  // 북부 게이트웨이(지룽/타오위안)가 중국 통제에 들어가면,
  // 다음 north_pressure는 타이베이 내륙 압박으로 전환된다.
  // v0.2 설계상 타이베이는 직접 상륙 불가지만, 지룽/타오위안 경유로 함락 가능해야 한다.
  if (axis?.id === "north_pressure") {
    const gatewayControlled = ["keelung", "taoyuan"].some((id) =>
      state.provinces[id]?.controlStage === "china_control"
    );
    if (gatewayControlled && state.provinces.taipei?.controlStage !== "china_control") {
      return "taipei";
    }
  }

  // 남부 거점이 함락되면 후속 압박은 타이중으로 연결된다.
  // 현재 승리 조건은 아니지만, 장기전의 전선 이동 로그와 향후 UI를 위해 열어둔다.
  if (axis?.id === "south_landing") {
    const southGatewayControlled = ["kaohsiung", "tainan"].some((id) =>
      state.provinces[id]?.controlStage === "china_control"
    );
    if (southGatewayControlled && state.provinces.taichung?.controlStage !== "china_control") {
      return "taichung";
    }
  }

  const candidates = AXIS_DEFAULT_TARGETS[axis?.id] || [];
  return chooseBestTarget(state, candidates, axis);
}

export function chooseBestTarget(state, candidates = [], source = null) {
  const valid = candidates
    .map((id) => state.provinces[id])
    .filter(Boolean)
    .filter((p) => p.controlStage !== "china_control");

  if (!valid.length) return null;

  // MVP 휴리스틱:
  //   1) 이미 상륙 단계가 진행된 지역 선호
  //   2) 방어가 약한 곳 선호
  //   3) 정치/보급 가치가 높은 곳 선호
  valid.sort((a, b) => {
    const aStage = LANDING_STAGES.indexOf(a.landingStage || "none");
    const bStage = LANDING_STAGES.indexOf(b.landingStage || "none");
    const aScore =
      aStage * 4 +
      (a.politicalValue || 0) * 0.7 +
      (a.supplyValue || 0) * 0.4 -
      effectiveProvinceDefense(state, a, source) * 0.8;
    const bScore =
      bStage * 4 +
      (b.politicalValue || 0) * 0.7 +
      (b.supplyValue || 0) * 0.4 -
      effectiveProvinceDefense(state, b, source) * 0.8;
    return bScore - aScore;
  });

  return valid[0].id;
}

export function resolveCombatOperation(state, {
  source,
  axis = null,
  targetId = null,
  randomFn = Math.random
} = {}) {
  const target = targetId ? state.provinces[targetId] : null;
  const roll = roll2d6(randomFn);

  const attackPower = calculateAttackPower(state, { source, axis, target, roll });
  const defensePower = calculateDefensePower(state, { source, axis, target });

  // v0.4.0-c2-b2.1: 전투 로그용 방어 보상 기여 분리 (지역 공격 한정)
  const defenseRewardBonus = (target && target.id !== "strait")
    ? collectPersistentDefenseContributors(state, target.id)
    : null;

  const margin = attackPower - defensePower;
  const success = margin >= 0;

  const result = {
    sourceId: source?.id || axis?.id || "unknown",
    sourceName: source?.name || axis?.name || "작전",
    axisId: axis?.id || source?.preferredAxis || state.thisTurn?.chinaAxis || null,
    targetId: target?.id || null,
    targetName: target?.name || "전역/비접촉 영역",
    roll,
    attackPower,
    defensePower,
    defenseRewardBonus, // null 또는 { total, contributors: [{rewardName, amount}, ...] }
    margin,
    success,
    grade: gradeMargin(margin)
  };

  return result;
}

// v0.4.0-c2-b2.1: 영구 방어 보상 기여자 수집 (전투 로그 표시용)
// 같은 지역 +2 캡을 반영하되, 각 기여 보상 이름은 따로 노출.
function collectPersistentDefenseContributors(state, provinceId) {
  const rewards = state.persistent?.rewards || [];
  if (!rewards.length) return null;

  const contributors = [];
  let raw = 0;
  for (const r of rewards) {
    if (r.applyTiming !== "persistent") continue;
    const def = r.effects?.defenseValueBonus;
    if (!def || !Array.isArray(def.regions) || !def.regions.includes(provinceId)) continue;
    const amount = Math.min(1, Math.max(0, def.amount || 0));
    if (amount > 0) {
      contributors.push({ rewardName: r.name, amount });
      raw += amount;
    }
  }
  if (contributors.length === 0) return null;
  // 캡: 실제 적용된 값은 최대 +2
  const total = Math.min(2, raw);
  return { total, raw, contributors };
}

export function calculateAttackPower(state, { source, axis, target, roll }) {
  let power = 6 + roll;

  // 이번 턴 중국 공격 보너스
  power += state.thisTurn?.attackBonus?.china || 0;

  // 카드/축 성격 보정
  if (source?.type === "attack") power += 1;
  if (source?.type === "ranged") power += 0;
  if (axis && source?.preferredAxis && source.preferredAxis === axis.id) power += 2;
  if (!source?.type && axis?.id) power += 1; // 주공축 자체 판정

  // 자원 상태 보정
  const tempo = state.gauges.chinaTempo ?? 50;
  const supply = state.gauges.chinaSupply ?? 50;
  if (tempo >= 70) power += 1;
  if (tempo < 40) power -= 2;
  if (supply >= 70) power += 1;
  if (supply < 40) power -= 2;

  // 상륙이 깊어질수록 다음 단계 진척은 조금 쉬워짐
  if (target) {
    const stageIndex = LANDING_STAGES.indexOf(target.landingStage || "none");
    if (stageIndex >= 2) power += 1;
  }

  // 인접 교두보가 완성된 뒤의 내륙 압박은 일반 해상 상륙보다 유리하다.
  // 지룽/타오위안 장악 후 타이베이, 가오슝/타이난 장악 후 타이중 압박에 적용.
  if (target?.id === "taipei" && hasControlledGateway(state, ["keelung", "taoyuan"])) {
    power += 5;
  }
  if (target?.id === "taichung" && hasControlledGateway(state, ["kaohsiung", "tainan"])) {
    power += 3;
  }

  // 날씨/해협 악화
  const weatherPenalty = state.persistent?.weatherEffect?.effects?.weatherPenalty || 0;
  power -= weatherPenalty;

  return power;
}

export function calculateDefensePower(state, { source, axis, target }) {
  // 정보전/외교전처럼 물리 타깃이 없는 작전은 추상 방어값 사용
  if (!target || target.id === "strait") {
    let abstractDefense = 11;

    if (axis?.id === "information_warfare" || source?.preferredAxis === "information_warfare") {
      abstractDefense += commandBandBonus(state.gauges.taiwanCommand);
    }
    if (axis?.id === "diplomatic_pressure" || source?.preferredAxis === "diplomatic_pressure") {
      abstractDefense += moraleBandBonus(state.gauges.taiwanMorale);
      abstractDefense += Math.floor((state.gauges.internationalOpinion || 0) / 35);
    }
    if (axis?.id === "naval_blockade" || source?.preferredAxis === "naval_blockade") {
      abstractDefense += Math.floor((state.gauges.taiwanSupply || 0) / 35);
    }

    abstractDefense -= state.thisTurn?.defenseDebuff || 0;
    return abstractDefense;
  }

  return effectiveProvinceDefense(state, target, source);
}

export function effectiveProvinceDefense(state, province, source = null) {
  let defense = 5 + (province.defenseValue || 0);

  defense += province.defenseValueModifier || 0;

  // 지역별 지속 버프가 province.buffs에 들어온 경우 대비
  for (const buff of province.buffs || []) {
    if (buff.effects?.defenseValueBonus) defense += buff.effects.defenseValueBonus;
  }

  // v0.4.0-c2-b2: persistent reward의 지역 방어 보너스 (최대 +2 캡)
  defense += computePersistentDefenseBonus(state, province.id);

  defense += moraleBandBonus(state.gauges.taiwanMorale);
  defense += commandBandBonus(state.gauges.taiwanCommand);

  // 대만 방어 중점이 지역 태그와 맞으면 보너스
  const focus = state.thisTurn?.taiwanFocus;
  if (focus && Array.isArray(province.tags) && province.tags.includes(focus)) {
    defense += 2;
  }
  if (focus === province.id) defense += 2;

  // 야간작전 등 방어 디버프
  defense -= state.thisTurn?.defenseDebuff || 0;

  // 이미 교두보가 잡힌 지역은 방어가 일부 무너짐
  const stageIndex = LANDING_STAGES.indexOf(province.landingStage || "none");
  if (stageIndex >= 3) defense -= 2;
  else if (stageIndex >= 2) defense -= 1;

  // 인접 교두보가 뚫린 수도/내륙 도시는 방어 조직이 흔들린다.
  if (province.id === "taipei" && hasControlledGateway(state, ["keelung", "taoyuan"])) {
    defense -= 2;
  }
  if (province.id === "taichung" && hasControlledGateway(state, ["kaohsiung", "tainan"])) {
    defense -= 1;
  }

  return defense;
}

function hasControlledGateway(state, ids = []) {
  return ids.some((id) => state.provinces?.[id]?.controlStage === "china_control");
}

function moraleBandBonus(v = 50) {
  if (v >= 70) return 1;
  if (v < 55) return -1;
  return 0;
}

function commandBandBonus(v = 50) {
  if (v >= 70) return 1;
  if (v < 55) return -1;
  return 0;
}

function gradeMargin(margin) {
  if (margin >= 6) return "decisive_success";
  if (margin >= 0) return "success";
  if (margin <= -6) return "decisive_failure";
  return "failure";
}

export function formatCombatLog(result) {
  const mark = result.success ? "성공" : "실패";
  const sign = result.margin >= 0 ? "+" : "";
  let defenseStr = `방어 ${result.defensePower}`;
  // v0.4.0-c2-b2.1: 영구 방어 보상 기여 분리 표시
  if (result.defenseRewardBonus && result.defenseRewardBonus.total > 0) {
    const names = result.defenseRewardBonus.contributors.map(c => c.rewardName).join(", ");
    defenseStr += ` (영구 방어 +${result.defenseRewardBonus.total}: ${names})`;
  }
  return `${result.sourceName} ${mark}: ${result.targetName} | 공격 ${result.attackPower} vs ${defenseStr} | 차이 ${sign}${result.margin} | 주사위 ${result.roll}`;
}
