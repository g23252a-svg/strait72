// v0.3.9 카드 툴팁 빌더 smoke test
import fs from "node:fs";
import { buildCardTooltipHTML, formatEffects, formatCost, getDisabledReason, EFFECT_LABELS, COST_LABELS } from "./card_tooltip.js";

const dataDir = new URL("../data/", import.meta.url);
const cc = JSON.parse(fs.readFileSync(new URL("cards_china.json", dataDir), "utf8"));
const ct = JSON.parse(fs.readFileSync(new URL("cards_taiwan.json", dataDir), "utf8"));
const provinces = JSON.parse(fs.readFileSync(new URL("provinces.json", dataDir), "utf8"));

// 1. 모든 카드의 모든 effect 키가 EFFECT_LABELS에 있는지
let missing = new Set();
for (const c of [...cc, ...ct]) {
  const allEffects = [
    ...Object.keys(c.effects || {}),
    ...Object.keys(c.successEffects || {}),
    ...Object.keys(c.failureEffects || {}),
    ...Object.keys(c.riskOnFailure || {})
  ];
  for (const k of allEffects) if (!EFFECT_LABELS[k]) missing.add(k);
}
if (missing.size) {
  console.warn("⚠ EFFECT_LABELS에 누락된 키 (자동 번역 실패):", [...missing]);
} else {
  console.log("✓ 모든 effect 키 EFFECT_LABELS에 매핑됨");
}

// 2. 모든 카드의 cost 키가 COST_LABELS에 있는지
const missingCost = new Set();
for (const c of [...cc, ...ct]) {
  for (const k of Object.keys(c.cost || {})) if (!COST_LABELS[k]) missingCost.add(k);
}
if (missingCost.size) console.warn("⚠ COST_LABELS 누락:", [...missingCost]);
else console.log("✓ 모든 cost 키 COST_LABELS에 매핑됨");

// 3. buildCardTooltipHTML이 모든 카드에 대해 정상 동작
const dummyState = { gauges: { chinaTempo: 5, chinaSupply: 5, chinaReserveTroops: 5, taiwanCommand: 5, taiwanSupply: 5, taiwanReserveTroops: 5, taiwanInternationalRequest: 3 } };
let ok = 0;
for (const c of [...cc, ...ct]) {
  const html = buildCardTooltipHTML(c, dummyState, c.side, provinces);
  if (typeof html === "string" && html.length > 50 && html.includes(c.name)) ok++;
  else { console.error("FAIL:", c.id); break; }
}
console.log(`✓ ${ok}/${cc.length + ct.length} 카드 툴팁 정상 생성`);

// 4. disabled reason 시뮬 (비용 부족)
const blitzOrder = cc.find(c => c.id === "china_blitz_order");
const emptyState = { gauges: { chinaTempo: 0 } };  // tempo 0 → 비용 부족
const reason = getDisabledReason(blitzOrder, emptyState, "china");
if (!reason) throw new Error("getDisabledReason should detect insufficient tempo");
console.log(`✓ getDisabledReason 동작: "${reason}"`);

console.log("\ntooltip smoke test passed");
