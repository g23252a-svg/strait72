# Strait 72 v0.2 Balance Simulation Report

Command:
node src/run_balance_sim.mjs --runs=50 --seed=42 --detail

## Result summary

- runs: 50
- outcome: taiwan_political_collapse_win 50/50 (100.0%)
- avgFinalTurn: 17.8
- combat success rate: 15.2%
- avg final chinaPoliticalPressure: 100
- avg final usIntervention: 8.52
- avg final japanIntervention: 6.8
- avg final koreaRearSupport: 10

## Event summary

- global_bad_weather: 126 total, avg/run 2.52, seen 100.0%
- global_market_crash: 47 total, avg/run 0.94, seen 94.0%

## Immediate design findings

1. China is losing by political pressure in every sampled run.
2. Combat success rate is too low at 15.2%, so riskOnFailure dominates the simulation.
3. U.S. and Japan intervention gauges are being suppressed too hard; diplomatic pressure and related cards can drive them near zero.
4. Korea rear support never activates in these runs because U.S. intervention never reaches the threshold.
5. Taiwan government/morale/supply remain almost untouched, so China is not creating meaningful collapse pressure.

## Recommended next balancing patch

- Lower combat threshold or increase axis/card attack power slightly.
- Reduce repeated diplomatic suppression or add floor/decay resistance to intervention gauges.
- Make China political pressure increase less aggressively on every failed axis after the 72h deadline.
- Add deck/hand cycle before serious balance conclusions, because current hands exhaust early.
