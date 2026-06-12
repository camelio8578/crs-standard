/**
 * test/backtest.js — Commandment X, executable.
 * "Every failure becomes a factor."
 *
 * This test asserts that CRS V1.0, run on the published inputs as they
 * stood on each incident's listing day, produces the protective verdict
 * the market failed to reach. If any assertion fails, the standard has
 * broken its own constitution and must not ship.
 *
 * Run: npm test   (or: node test/backtest.js)
 */

'use strict';

const { scoreAsset, ASSETS } = require('./crs-scorer');

let passed = 0, failed = 0;
function assert(label, condition, detail) {
  if (condition) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.error(`  FAIL  ${label} — ${detail}`); }
}

console.log('\nCRS V1.0 Backtest Suite — the standard against the historical record\n');

// --- Incident 1: rsETH on Aave (April 2026) -------------------------------
// Market verdict at the time: 93% LTV / 95% LT in eMode.
// Required CRS verdict: INELIGIBLE via Gate G2 (single-attestor bridge route).
const rs = scoreAsset(ASSETS.RSETH);
assert('rsETH is INELIGIBLE on listing day', rs.eligible === false, `got eligible=${rs.eligible}`);
assert('rsETH ineligibility is gate-driven (G2)', rs.gates.some(g => g.gate === 'G2'), `gates=${JSON.stringify(rs.gates)}`);
assert('rsETH max LTV is zero (vs market 93%)', rs.maxLtvPct === 0, `got ${rs.maxLtvPct}`);

// --- Incident 2: wrsETH on L2s --------------------------------------------
// Fourth wrap layer over a compromised shared supply.
// Required verdict: INELIGIBLE via G1 (wrap depth) and G2 (bridge).
const wrs = scoreAsset(ASSETS.WRSETH);
assert('wrsETH is INELIGIBLE', wrs.eligible === false, `got eligible=${wrs.eligible}`);
assert('wrsETH trips wrap-depth gate G1', wrs.gates.some(g => g.gate === 'G1'), `gates=${JSON.stringify(wrs.gates)}`);
assert('wrsETH trips bridge gate G2', wrs.gates.some(g => g.gate === 'G2'), `gates=${JSON.stringify(wrs.gates)}`);

// --- Incident class 3: PT-style self-referential oracles -------------------
// Linear-discount model pricing with no external market check.
// Required verdict: Gate G4 fires; LTV materially below the 90%+ market practice.
const pt = scoreAsset(ASSETS.PT_SUSDE);
assert('PT-sUSDe trips oracle gate G4', pt.gates.some(g => g.gate === 'G4'), `gates=${JSON.stringify(pt.gates)}`);
assert('PT-sUSDe max LTV is at least 25 points below market practice (90%+)', pt.maxLtvPct <= 65, `got ${pt.maxLtvPct}`);

// --- Incident class 4: unverified off-chain backing (Tangible/USDR class) --
// Modeled via the gate logic itself: any off-chain backing without
// independent recurring verification must be capped at Tier 3.
const usdrLike = scoreAsset({
  symbol: 'USDR-CLASS', name: 'Unverified RWA-backed stable (incident-class profile)', asOf: 'incident',
  inputs: {
    liquidity: { exitCapacityUsd24h: 5e7, slippagePctAtSize: 0.8, independentVenues: 3, largestProtocolPositionUsd: 4e7 },
    wrap: { wrapDepth: 1, parUnwrapPath: true },
    bridge: { bridgedSupply: false, sharedSupplyOFT: false, minVerifiersOnAnyRoute: 99, supplyInvariantMonitored: true },
    oracle: { externalMarketOracle: true, independentProviders: 2, deviationProtection: true, selfReferential: false },
    redemption: { parRedemption: true, permissionless: true, noticeHours: 24, issuerCanPause: true },
    duration: { timeBound: false, daysToMaturity: null, preMaturityParExit: false },
    backing: { backingType: 'physical', verification: 'self_reported' },
    operational: { adminTimelock: true, upgradeable: true, curatorConcentration: 'none', withdrawalFreezeAuthority: false, incidentHistory: false },
  },
});
assert('Unverified physical backing trips gate G3', usdrLike.gates.some(g => g.gate === 'G3'), `gates=${JSON.stringify(usdrLike.gates)}`);
assert('Unverified backing is capped at Tier 3 or below', ['T3','T4','T5'].includes(usdrLike.tier), `got ${usdrLike.tier}`);

// --- Incident class 5: curator risk (Morpho freezes, Elixir/Steam) ---------
// Withdrawal-freeze authority and single-curator concentration must be
// priced BEFORE listing, not discovered after.
const cv = scoreAsset(ASSETS.CURATED_VAULT);
assert('Single-curator vault with freeze authority lands at Tier 3 or below', ['T3','T4','T5'].includes(cv.tier), `got ${cv.tier}`);

// --- Sanity: the standard must not punish sound collateral -----------------
const weth = scoreAsset(ASSETS.WETH);
assert('WETH remains core (Tier 1) collateral', weth.tier === 'T1', `got ${weth.tier}`);
assert('No gates fire on WETH', weth.gates.length === 0, `gates=${JSON.stringify(weth.gates)}`);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
