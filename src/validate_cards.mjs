import fs from "node:fs";

const provinces = JSON.parse(fs.readFileSync(new URL("../data/provinces.json", import.meta.url), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("../data/axes.json", import.meta.url), "utf8"));
const adjacency = JSON.parse(fs.readFileSync(new URL("../data/province_adjacency.json", import.meta.url), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("../data/cards_china.json", import.meta.url), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("../data/cards_taiwan.json", import.meta.url), "utf8"));

const provinceIds = new Set(provinces.map((p) => p.id));
const axisIds = new Set(axes.map((a) => a.id));
const allCards = [...cardsChina, ...cardsTaiwan];
const cardIds = new Set();
const errors = [];

const ALLOWED_TARGETS_SPECIAL = new Set(["any", "selected_province"]);
const ALLOWED_COSTS = new Set(["tempo", "supply", "command", "reserveTroops", "internationalRequest"]);
const ALLOWED_SIDES = new Set(["china", "taiwan"]);
const ALLOWED_TYPES = new Set([
  "standard", "attack", "ranged", "action_buff", "support", "modifier",
  "counterplay", "bluff", "rally", "defense_buff", "diplomacy",
  "buff_persistent", "intel", "recovery"
]);

// 1. 카드 ID 중복 + 측 + 타입 검증
for (const card of allCards) {
  if (!card.id) {
    errors.push(`card missing id: ${JSON.stringify(card).slice(0, 60)}`);
    continue;
  }
  if (cardIds.has(card.id)) errors.push(`duplicate card id: ${card.id}`);
  cardIds.add(card.id);

  if (!ALLOWED_SIDES.has(card.side)) errors.push(`invalid side: ${card.id} -> ${card.side}`);
  if (!ALLOWED_TYPES.has(card.type)) errors.push(`invalid type: ${card.id} -> ${card.type}`);
  if (!card.name) errors.push(`card missing name: ${card.id}`);
  if (!card.description) errors.push(`card missing description: ${card.id}`);
}

// 2. preferredAxis 참조 검증
for (const card of allCards) {
  if (card.preferredAxis && !axisIds.has(card.preferredAxis)) {
    errors.push(`unknown preferredAxis: ${card.id} -> ${card.preferredAxis}`);
  }
}

// 3. target 참조 검증
for (const card of allCards) {
  if (card.target === undefined) continue;
  const targets = Array.isArray(card.target) ? card.target : [card.target];
  for (const t of targets) {
    if (ALLOWED_TARGETS_SPECIAL.has(t)) continue;
    if (!provinceIds.has(t)) errors.push(`unknown target province: ${card.id} -> ${t}`);
  }
}

// 4. cost 키 검증
for (const card of allCards) {
  if (!card.cost) continue;
  for (const key of Object.keys(card.cost)) {
    if (!ALLOWED_COSTS.has(key)) errors.push(`unknown cost key: ${card.id} -> ${key}`);
  }
}

// 5. trigger.respondsTo / canBeCounteredBy / canBeRevealedBy 교차 참조
function checkRef(card, fieldPath, refs) {
  if (!Array.isArray(refs)) return;
  for (const ref of refs) {
    if (typeof ref !== "string") {
      errors.push(`invalid ref type: ${card.id}.${fieldPath} -> ${ref}`);
      continue;
    }
    if (ref.startsWith("axis:")) {
      const axisId = ref.slice(5);
      if (!axisIds.has(axisId)) errors.push(`unknown axis ref: ${card.id}.${fieldPath} -> ${ref}`);
    } else {
      if (!cardIds.has(ref)) errors.push(`unknown card ref: ${card.id}.${fieldPath} -> ${ref}`);
    }
  }
}

for (const card of allCards) {
  if (card.trigger && card.trigger.respondsTo) {
    checkRef(card, "trigger.respondsTo", card.trigger.respondsTo);
  }
  if (card.canBeCounteredBy) checkRef(card, "canBeCounteredBy", card.canBeCounteredBy);
  if (card.canBeRevealedBy) checkRef(card, "canBeRevealedBy", card.canBeRevealedBy);
}

// 6. combos 검증
for (const card of allCards) {
  if (!card.combos) continue;
  if (card.combos.withAxis) {
    for (const axisRef of card.combos.withAxis) {
      if (!axisIds.has(axisRef)) errors.push(`unknown combo axis: ${card.id} -> ${axisRef}`);
    }
  }
}

// 7. 카운터플레이 카드는 trigger 필수
for (const card of allCards) {
  if (card.type === "counterplay" && (!card.trigger || !card.trigger.respondsTo)) {
    errors.push(`counterplay card without trigger.respondsTo: ${card.id}`);
  }
}

// 8. 블러프 카드는 facedown:true 필수
for (const card of allCards) {
  if (card.type === "bluff" && card.facedown !== true) {
    errors.push(`bluff card without facedown:true: ${card.id}`);
  }
}

// 9. 양측 카드 수 균형 (MVP는 10:10)
if (cardsChina.length !== cardsTaiwan.length) {
  console.warn(`warning: card count imbalance china=${cardsChina.length} taiwan=${cardsTaiwan.length}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

// 분류 통계
function countByType(cards) {
  const acc = {};
  for (const c of cards) acc[c.type] = (acc[c.type] || 0) + 1;
  return acc;
}

console.log("cards validation passed");
console.log(`china=${cardsChina.length} taiwan=${cardsTaiwan.length}`);
console.log(`china types: ${JSON.stringify(countByType(cardsChina))}`);
console.log(`taiwan types: ${JSON.stringify(countByType(cardsTaiwan))}`);

const counterChains = [];
for (const card of allCards) {
  if (card.canBeCounteredBy) {
    for (const ref of card.canBeCounteredBy) counterChains.push(`${card.id} <- ${ref}`);
  }
  if (card.trigger && card.trigger.respondsTo) {
    for (const ref of card.trigger.respondsTo) counterChains.push(`${ref} -> ${card.id}`);
  }
}
console.log(`counterplay chains: ${counterChains.length}`);
for (const chain of counterChains) console.log(`  ${chain}`);
