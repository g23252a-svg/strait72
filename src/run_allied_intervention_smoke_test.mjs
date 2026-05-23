// =====================================================================
// Allied intervention smoke test
// ---------------------------------------------------------------------
// 미국 개입도 100은 즉시 게임 종료가 아니라,
// 동맹 개입 단계로 전환된 뒤 전투가 계속 진행되는지 확인한다.
// =====================================================================

import fs from "node:fs";
import { createInitialState, buildCardIndex, buildAxisIndex } from "./state.js";
import { initializeDecks } from "./deck_state.js";
import { runTurn } from "./turn_resolver.js";
import { GAME_RULES } from "./game_rules.js";

const dataDir = new URL("../data/", import.meta.url);
const provinces = JSON.parse(fs.readFileSync(new URL("provinces.json", dataDir), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("axes.json", dataDir), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("cards_china.json", dataDir), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("cards_taiwan.json", dataDir), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("events_global.json", dataDir), "utf8"));

const state = createInitialState({
  provinces,
  gameRules: GAME_RULES,
  axes,
  cardsChina,
  cardsTaiwan,
  events
});
initializeDecks(state, cardsChina, cardsTaiwan);

state.gauges.usIntervention = 99;

const indices = {
  cardIndex: buildCardIndex(cardsChina, cardsTaiwan),
  axisIndex: buildAxisIndex(axes),
  events
};

runTurn(state, {
  chinaAxis: "south_landing",
  taiwanFocus: "kaohsiung",
  selectedProvince: "kaohsiung",
  chinaCards: ["china_south_landing_prep"],
  taiwanCards: ["taiwan_harbor_defense"]
}, indices);

if (!state.persistent.alliedIntervention.active) {
  throw new Error("expected alliedIntervention.active=true after US intervention reaches 100");
}
if (state.outcome === "taiwan_us_intervention_win") {
  throw new Error("US intervention must not immediately end the game");
}
if (state.outcome) {
  throw new Error(`unexpected outcome after allied intervention activation: ${state.outcome}`);
}
if (state.turn <= 1) {
  throw new Error("turn did not advance after allied intervention activation");
}

console.log("allied intervention smoke test passed");
console.log(`turn=${state.turn} us=${state.gauges.usIntervention} allied=${state.persistent.alliedIntervention.active} outcome=${state.outcome}`);
