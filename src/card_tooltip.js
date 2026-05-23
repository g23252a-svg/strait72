// =====================================================================
// card_tooltip.js  (v0.3.9 introduced)
// ---------------------------------------------------------------------
// 카드 hover 툴팁 빌더.
//   - 자동 번역: effects/cost/target/trigger → 한국어 라벨
//   - card.description이 있으면 자연어 요약을 상단에 우선 표시
//   - 비용 부족 등 사용 불가 사유 표시
// =====================================================================

export const EFFECT_LABELS = {
  // 공격/방어
  attackBonus:                       { label: "공격력 보너스",          suffix: "" },
  defenseValueBonus:                 { label: "지역 방어력 보강",       suffix: "" },
  defenseValueDamage:                { label: "지역 방어력 피해",       suffix: "" },
  nextTurnDefenseValueBonus:         { label: "다음 턴 방어력 보강",    suffix: "" },
  nextTurnTempoBonus:                { label: "다음 턴 작전 템포",      suffix: "" },
  taiwanDefenseValueDebuff:          { label: "대만 지역 방어력 디버프", suffix: "" },

  // 상륙
  landingProgressBonus:              { label: "상륙 진척",              suffix: "단계" },
  landingProgressBonusOnSuccess:     { label: "성공 시 상륙 진척",      suffix: "단계" },
  landingProgressRegressChance:      { label: "상륙 후퇴 확률",         suffix: "%" },

  // 자원
  chinaSupply:                       { label: "중국 보급력",            suffix: "" },
  supplyGainOnSuccess:               { label: "성공 시 중국 보급",      suffix: "" },
  taiwanSupplyDamage:                { label: "대만 보급 피해",         suffix: "" },
  taiwanGovernment:                  { label: "대만 정부 기능",         suffix: "" },
  taiwanGovernmentDamage:            { label: "대만 정부 기능 피해",    suffix: "" },
  taiwanCommand:                     { label: "대만 지휘 체계",         suffix: "" },
  taiwanCommandDamage:               { label: "대만 지휘 피해",         suffix: "" },
  taiwanCommandDamageReduction:      { label: "대만 지휘 피해 경감",    suffix: "" },
  taiwanMorale:                      { label: "대만 국민 사기",         suffix: "" },

  // 국제 개입
  usInterventionGain:                { label: "미국 개입도",            suffix: "" },
  usInterventionGainReduction:       { label: "미국 개입도 증가 감쇄",  suffix: "" },
  japanInterventionGain:             { label: "일본 개입도",            suffix: "" },
  japanInterventionGainReduction:    { label: "일본 개입도 증가 감쇄",  suffix: "" },
  internationalOpinion:              { label: "국제 여론",              suffix: "" },
  chinaPoliticalPressure:            { label: "중국 정치 압박",         suffix: "" },

  // 정보전 / 블러프
  chinaInformationWarfareReduction:  { label: "중국 정보전 감쇄",        suffix: "×" },
  deceptionTarget:                   { label: "기만 대상",              suffix: "" },
  ifChinaMisreads:                   { label: "중국 오판 시 추가",      suffix: "" },
  ifTaiwanMisreads:                  { label: "대만 오판 시 추가",      suffix: "" },
  revealOpponentBluff:               { label: "상대 블러프 공개",       suffix: "" },

  // 중첩 effect (ifXxxMisreads 내부 등)
  nextTurnAttackBonus:               { label: "다음 턴 공격력 보너스",  suffix: "" },
  nextTurnCounterAttackBonus:        { label: "다음 턴 반격 보너스",    suffix: "" },
  taiwanReserveLockout:              { label: "대만 예비군 봉쇄",       suffix: "" }
};

export const COST_LABELS = {
  tempo:               "작전 템포",
  supply:              "보급",
  command:             "지휘",
  reserveTroops:       "예비 병력",
  internationalRequest:"국제 요청"
};

export const TYPE_LABELS = {
  standard:        "표준 작전",
  attack:          "공격",
  ranged:          "원거리",
  action_buff:     "작전 버프",
  bluff:           "블러프",
  counterplay:     "카운터플레이",
  support:         "지원",
  modifier:        "수정자",
  rally:           "결집",
  defense_buff:    "방어 버프",
  diplomacy:       "외교",
  buff_persistent: "지속 버프",
  intel:           "정보",
  recovery:        "복구"
};

const AXIS_KOREAN = {
  north_pressure:      "북부 압박",
  south_landing:       "남부 상륙",
  naval_blockade:      "해상 봉쇄",
  information_warfare: "정보전",
  diplomatic_pressure: "외교 압박"
};

// ---------------------------------------------------------------------
// Formatter helpers
// ---------------------------------------------------------------------

function formatValue(key, value) {
  const def = EFFECT_LABELS[key];
  if (!def) return `${key}: ${formatPrimitive(value)}`;
  const sign = (typeof value === "number" && value > 0) ? "+" : "";
  if (typeof value === "object" && value !== null) {
    // nested effects (e.g. ifChinaMisreads: { taiwanCommandDamage: 3 })
    const inner = Object.entries(value).map(([k, v]) => formatValue(k, v)).join(", ");
    return `${def.label} → ${inner}`;
  }
  return `${def.label} ${sign}${value}${def.suffix ? " " + def.suffix : ""}`.trim();
}

function formatPrimitive(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function formatEffects(effects) {
  if (!effects || !Object.keys(effects).length) return [];
  return Object.entries(effects).map(([k, v]) => formatValue(k, v));
}

function gaugeKeyForCost(costKey, side) {
  if (costKey === "tempo") return "chinaTempo";
  if (costKey === "supply") return "chinaSupply";
  if (costKey === "command") return side === "china" ? "chinaTempo" : "taiwanCommand";
  if (costKey === "reserveTroops") return side === "china" ? "chinaReserveTroops" : "taiwanReserveTroops";
  if (costKey === "internationalRequest") return "taiwanInternationalRequest";
  return null;
}

export function formatCost(cost, state, side) {
  if (!cost || !Object.keys(cost).length) return [{ text: "비용 없음", insufficient: false }];
  return Object.entries(cost).map(([k, v]) => {
    const label = COST_LABELS[k] || k;
    const gaugeKey = gaugeKeyForCost(k, side);
    const current = state?.gauges?.[gaugeKey];
    const insufficient = gaugeKey != null && (current ?? 0) < v;
    const cur = (gaugeKey && current !== undefined) ? ` (현재 ${Math.round(current)})` : "";
    return { text: `${label} -${v}${cur}`, insufficient };
  });
}

export function formatTargets(card, provinces) {
  if (!card.target) return "유연 (지정 대상 없음)";
  if (!Array.isArray(card.target)) return String(card.target);
  if (!card.target.length) return "유연 (지정 대상 없음)";
  const provById = {};
  for (const p of (provinces || [])) provById[p.id] = p.name;
  return card.target.map(id => provById[id] || id).join(" / ");
}

export function formatCounterplay(card) {
  if (!card.trigger?.respondsTo) return null;
  const items = card.trigger.respondsTo.map(ref => {
    if (ref.startsWith("axis:")) return `${AXIS_KOREAN[ref.slice(5)] || ref.slice(5)} 축`;
    return ref;  // 카드 ID는 그대로 (간단 표시)
  });
  return `반응 대상: ${items.join(", ")}`;
}

export function formatCombo(card) {
  if (!card.combos?.withAxis?.length) return null;
  const axes = card.combos.withAxis.map(a => AXIS_KOREAN[a] || a).join(", ");
  return `연계: ${axes} 축에서 보너스`;
}

export function getDisabledReason(card, state, side) {
  if (!card.cost) return null;
  for (const [key, amount] of Object.entries(card.cost)) {
    const gaugeKey = gaugeKeyForCost(key, side);
    if (!gaugeKey) continue;
    const cur = state?.gauges?.[gaugeKey] ?? 0;
    if (cur < amount) {
      const label = COST_LABELS[key] || key;
      return `${label} 부족 (${Math.round(cur)} / ${amount} 필요)`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------

export function buildCardTooltipHTML(card, state, side, provinces) {
  const lines = [];
  const type = TYPE_LABELS[card.type] || card.type;
  const axisRef = card.preferredAxis ? ` · ${AXIS_KOREAN[card.preferredAxis] || card.preferredAxis}` : "";

  lines.push(`<div class="ct-header">
    <h4>${escapeHtml(card.name)}</h4>
    <span class="ct-meta">${escapeHtml(type)}${escapeHtml(axisRef)}</span>
  </div>`);

  if (card.description) {
    lines.push(`<p class="ct-desc">${escapeHtml(card.description)}</p>`);
  }

  const effects = formatEffects(card.effects);
  if (effects.length) {
    lines.push(section("효과", effects));
  }

  const succ = formatEffects(card.successEffects);
  if (succ.length) {
    lines.push(section("성공 시", succ, "ct-ok"));
  }

  const fail = formatEffects(card.failureEffects);
  if (fail.length) {
    lines.push(section("실패 시", fail, "ct-danger"));
  }

  const risk = formatEffects(card.riskOnFailure);
  if (risk.length) {
    lines.push(section("실패 위험", risk, "ct-danger"));
  }

  const costList = formatCost(card.cost, state, side);
  const costItems = costList.map(c => c.insufficient
    ? `<div class="ct-warn">· ${escapeHtml(c.text)}</div>`
    : `<div>· ${escapeHtml(c.text)}</div>`).join("");
  lines.push(`<div class="ct-section"><b>비용</b>${costItems}</div>`);

  const targets = formatTargets(card, provinces);
  lines.push(`<div class="ct-section"><b>타깃</b><div>${escapeHtml(targets)}</div></div>`);

  const counter = formatCounterplay(card);
  if (counter) lines.push(`<div class="ct-section ct-warn"><div>${escapeHtml(counter)}</div></div>`);

  const combo = formatCombo(card);
  if (combo) lines.push(`<div class="ct-section ct-ok"><div>${escapeHtml(combo)}</div></div>`);

  const disabled = getDisabledReason(card, state, side);
  if (disabled) {
    lines.push(`<div class="ct-section ct-warn"><b>사용 불가</b><div>${escapeHtml(disabled)}</div></div>`);
  }

  return lines.join("");
}

function section(title, items, klass = "") {
  const inner = items.map(t => `<div>· ${escapeHtml(t)}</div>`).join("");
  return `<div class="ct-section ${klass}"><b>${escapeHtml(title)}</b>${inner}</div>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
