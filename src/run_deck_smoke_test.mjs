// =====================================================================
// run_deck_smoke_test.mjs  (v0.3.6)
// ---------------------------------------------------------------------
// 손패/덱/버림 메커니즘 검증.
//   - 시작 손패 4장 / 매턴 드로우 2장 / 최대 5장
//   - 카드 사용 시 discard 이동
//   - 덱 소진 시 discard 자동 셔플 복귀
// =====================================================================

import fs from "node:fs";
import { createInitialState, buildCardIndex, buildAxisIndex } from "./state.js";
import { initializeDecks, drawCards, enforceHandLimit, discardCard, HAND_INIT, DRAW_PER_TURN, HAND_MAX } from "./deck_state.js";
import { runTurn } from "./turn_resolver.js";
import { GAME_RULES } from "./game_rules.js";

const dataDir = new URL("../data/", import.meta.url);
const provinces = JSON.parse(fs.readFileSync(new URL("provinces.json", dataDir), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("axes.json", dataDir), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("cards_china.json", dataDir), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("cards_taiwan.json", dataDir), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("events_global.json", dataDir), "utf8"));

const state = createInitialState({ provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events });
initializeDecks(state, cardsChina, cardsTaiwan);

// 1. 초기 상태 검증
if (state.decks.china.hand.length !== HAND_INIT) {
  throw new Error(`Initial china hand expected ${HAND_INIT}, got ${state.decks.china.hand.length}`);
}
if (state.decks.taiwan.hand.length !== HAND_INIT) {
  throw new Error(`Initial taiwan hand expected ${HAND_INIT}, got ${state.decks.taiwan.hand.length}`);
}
const expectedDeckSize = cardsChina.length - HAND_INIT;
if (state.decks.china.deck.length !== expectedDeckSize) {
  throw new Error(`Initial china deck expected ${expectedDeckSize}, got ${state.decks.china.deck.length}`);
}
console.log(`✓ 초기 손패 ${HAND_INIT}장 / 덱 ${expectedDeckSize}장`);

// 2. 턴 진행하면서 손패/덱/버림 추적
const indices = { cardIndex: buildCardIndex(cardsChina, cardsTaiwan), axisIndex: buildAxisIndex(axes), events };
const beforeT1 = { ...state.decks.china };
console.log(`T1 시작: 손패 ${state.decks.china.hand.length} / 덱 ${state.decks.china.deck.length} / 버림 ${state.decks.china.discard.length}`);

// T1 진행 (손패 중 첫 카드 1장 사용)
const t1Card = state.decks.china.hand[0];
runTurn(state, {
  chinaAxis: "north_pressure",
  taiwanFocus: "taipei",
  selectedProvince: "keelung",
  chinaCards: [t1Card],
  taiwanCards: []
}, indices);
console.log(`T2 시작: 손패 ${state.decks.china.hand.length} / 덱 ${state.decks.china.deck.length} / 버림 ${state.decks.china.discard.length}`);

// 3. 사용한 카드는 discard에 있어야 함
if (!state.decks.china.discard.includes(t1Card)) {
  throw new Error(`Used card ${t1Card} should be in discard after T1`);
}
console.log(`✓ 사용 카드 ${t1Card} discard로 이동 확인`);

// 4. 손패 5장 한도 검증 - 여러 턴 진행
for (let i = 0; i < 3; i++) {
  runTurn(state, {
    chinaAxis: "naval_blockade",
    taiwanFocus: "taipei",
    selectedProvince: "strait",
    chinaCards: [],   // 사용 안 함 = 손패에 계속 쌓여야 함
    taiwanCards: []
  }, indices);
  if (state.decks.china.hand.length > HAND_MAX) {
    throw new Error(`T${state.turn} hand exceeded MAX ${HAND_MAX}: got ${state.decks.china.hand.length}`);
  }
}
console.log(`✓ 손패 한도 ${HAND_MAX}장 유지 (현재 손패 ${state.decks.china.hand.length}장)`);

// 5. 덱 소진 → discard 복귀 시뮬 (수동)
const probeState = createInitialState({ provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events });
initializeDecks(probeState, cardsChina, cardsTaiwan);
// 덱 비우고 discard에 일부 카드 넣기
probeState.decks.china.discard = [...probeState.decks.china.deck];
probeState.decks.china.deck = [];
const before = probeState.decks.china.discard.length;
drawCards(probeState, "china", 1);
if (probeState.decks.china.discard.length >= before) {
  throw new Error("Deck reshuffle failed: discard should be moved into deck");
}
console.log(`✓ 덱 소진 시 discard 자동 셔플 복귀 (deck reshuffled from discard)`);

console.log("\ndeck_state smoke test passed");
console.log(`final state: china hand=${state.decks.china.hand.length}, deck=${state.decks.china.deck.length}, discard=${state.decks.china.discard.length}`);
