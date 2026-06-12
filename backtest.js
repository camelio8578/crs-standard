/**
 * crs-scorer.js — CRS (Collateral Risk Standard) V1.0 Reference Scorer
 * Sister engine to RWALS scorer.js
 *
 * Commandment III: every score is reproducible from published inputs.
 * This file IS the published methodology. Run it on the published inputs
 * and you get the published score, bit for bit.
 *
 * Drop-in for the rwals-server Express backend:
 *   const { scoreAsset, ASSETS, scoreAll } = require('./crs-scorer');
 *   app.get('/crs/scores', (req, res) => res.json(scoreAll()));
 *   app.get('/crs/scores/:symbol', (req, res) => {
 *     const a = ASSETS[req.params.symbol.toUpperCase()];
 *     if (!a) return res.status(404).json({ error: 'unknown asset' });
 *     res.json(scoreAsset(a));
 *   });
 */

'use strict';

const METHODOLOGY_VERSION = 'CRS-1.0';

// ---------------------------------------------------------------------------
// Dimension weights (must sum to 1.0) — Section 2.1 of the methodology
// ---------------------------------------------------------------------------
const WEIGHTS = {
  D1_liquidity: 0.20,
  D2_wrapDepth: 0.15,
  D3_bridge: 0.12,
  D4_oracle: 0.13,
  D5_redemption: 0.12,
  D6_duration: 0.08,
  D7_verification: 0.12,
  D8_operational: 0.08,
};

// ---------------------------------------------------------------------------
// Dimension scoring functions — each takes the asset's published inputs
// and returns 0–100 (higher = safer). Rubric anchors per Section 4.
// ---------------------------------------------------------------------------

// D1: Liquidity Depth & Exit Capacity (RWALS DNA)
function scoreD1(inputs) {
  const { exitCapacityUsd24h, slippagePctAtSize, independentVenues, largestProtocolPositionUsd } = inputs.liquidity;
  let s = 0;
  // Exit capacity vs. exposure
  const coverage = largestProtocolPositionUsd > 0 ? exitCapacityUsd24h / largestProtocolPositionUsd : 10;
  if (coverage >= 10) s = 100;
  else if (coverage >= 5) s = 85;
  else if (coverage >= 2) s = 65;
  else if (coverage >= 1) s = 40;
  else s = 15;
  // Slippage penalty
  if (slippagePctAtSize > 1) s -= 15;
  if (slippagePctAtSize > 3) s -= 15;
  // Venue concentration penalty
  if (independentVenues < 3) s -= 10;
  if (independentVenues < 2) s -= 15;
  return clamp(s);
}

// D2: Wrap & Rehypothecation Depth
function scoreD2(inputs) {
  const { wrapDepth, parUnwrapPath } = inputs.wrap;
  const base = { 0: 100, 1: 75, 2: 45, 3: 20 }[Math.min(wrapDepth, 3)] ?? 20;
  // A par unwrap path at every layer earns back up to 10 points
  return clamp(base + (parUnwrapPath ? 10 : 0));
}

// D3: Bridge & Cross-Chain Exposure
function scoreD3(inputs) {
  const { bridgedSupply, sharedSupplyOFT, minVerifiersOnAnyRoute, supplyInvariantMonitored } = inputs.bridge;
  if (!bridgedSupply) return 100;
  let s;
  if (minVerifiersOnAnyRoute >= 3) s = sharedSupplyOFT ? 70 : 85;
  else if (minVerifiersOnAnyRoute === 2) s = sharedSupplyOFT ? 45 : 60;
  else s = 10; // single attestor — Gate G2 will also fire
  if (supplyInvariantMonitored) s += 10;
  return clamp(s);
}

// D4: Oracle Integrity
function scoreD4(inputs) {
  const { externalMarketOracle, independentProviders, deviationProtection, selfReferential } = inputs.oracle;
  if (selfReferential && !externalMarketOracle) return 25; // Gate G4 will cap tier
  let s = externalMarketOracle ? 60 : 30;
  if (independentProviders >= 2) s += 20;
  if (deviationProtection) s += 20;
  return clamp(s);
}

// D5: Redemption Posture
function scoreD5(inputs) {
  const { parRedemption, permissionless, noticeHours, issuerCanPause } = inputs.redemption;
  if (!parRedemption) return 0; // secondary market only is not redemption
  let s = 60;
  if (permissionless) s += 20;
  if (noticeHours <= 24) s += 20;
  else if (noticeHours <= 168) s += 10;
  if (issuerCanPause) s -= 30;
  return clamp(s);
}

// D6: Duration Risk
function scoreD6(inputs) {
  const { timeBound, daysToMaturity, preMaturityParExit } = inputs.duration;
  if (!timeBound) return 100;
  let s;
  if (daysToMaturity >= 180) s = 70;
  else if (daysToMaturity >= 90) s = 55;
  else if (daysToMaturity >= 30) s = 40;
  else s = 15; // Gate G5 step-down also applies
  if (preMaturityParExit) s += 20; // par exit, not AMM exit
  return clamp(s);
}

// D7: Backing Verification
function scoreD7(inputs) {
  const { backingType, verification } = inputs.backing;
  // backingType: 'native' | 'onchain' | 'offchain' | 'physical'
  if (backingType === 'native') return 100;
  const v = verification; // 'realtime_por' | 'recurring_independent' | 'quarterly_audit' | 'self_reported' | 'none'
  const table = {
    realtime_por: 100,
    recurring_independent: 85,
    quarterly_audit: 50,
    self_reported: 15,
    none: 0,
  };
  return clamp(table[v] ?? 0);
}

// D8: Operational & Governance Risk
function scoreD8(inputs) {
  const { adminTimelock, upgradeable, curatorConcentration, withdrawalFreezeAuthority, incidentHistory } = inputs.operational;
  let s = 70;
  if (adminTimelock) s += 15;
  if (!upgradeable) s += 15;
  if (curatorConcentration === 'single') s -= 25;
  if (withdrawalFreezeAuthority) s -= 25;
  if (incidentHistory) s -= 20;
  return clamp(s);
}

// ---------------------------------------------------------------------------
// Hard gates — Section 2.2. Gates cannot be averaged away (Commandment IV).
// ---------------------------------------------------------------------------
function evaluateGates(inputs) {
  const gates = [];
  if (inputs.wrap.wrapDepth >= 4) {
    gates.push({ gate: 'G1', rule: 'Wrap depth >= 4 layers', effect: 'INELIGIBLE' });
  }
  if (inputs.bridge.bridgedSupply && inputs.bridge.minVerifiersOnAnyRoute <= 1) {
    gates.push({ gate: 'G2', rule: 'Single-attestor bridge route in supply graph', effect: 'INELIGIBLE' });
  }
  if ((inputs.backing.backingType === 'physical' || inputs.backing.backingType === 'offchain')
      && !['realtime_por', 'recurring_independent'].includes(inputs.backing.verification)) {
    gates.push({ gate: 'G3', rule: 'Off-chain/physical backing without independent recurring verification', effect: 'TIER3_CAP' });
  }
  if (inputs.oracle.selfReferential && !inputs.oracle.externalMarketOracle) {
    gates.push({ gate: 'G4', rule: 'Self-referential oracle, no external market check', effect: 'TIER3_CAP' });
  }
  if (inputs.duration.timeBound && inputs.duration.daysToMaturity < 30) {
    gates.push({ gate: 'G5', rule: 'Time-to-maturity under 30 days', effect: 'STEP_DOWN' });
  }
  return gates;
}

// ---------------------------------------------------------------------------
// Composite, tier, and the continuous parameter map — Section 2.3
// maxLTV% = 0.75 * CRS + 20 for CRS >= 40, else ineligible. No cliffs.
// ---------------------------------------------------------------------------
function tierFromScore(score, gates) {
  if (gates.some(g => g.effect === 'INELIGIBLE')) return 'T5';
  let tier;
  if (score >= 85) tier = 'T1';
  else if (score >= 70) tier = 'T2';
  else if (score >= 55) tier = 'T3';
  else if (score >= 40) tier = 'T4';
  else tier = 'T5';
  // Tier caps from G3/G4
  if (gates.some(g => g.effect === 'TIER3_CAP') && (tier === 'T1' || tier === 'T2')) tier = 'T3';
  return tier;
}

const TIER_SCORE_CEILING = { T3: 69 }; // when a cap applies, the effective score is also capped

function maxLtvFromScore(score, tier) {
  if (tier === 'T5' || score < 40) return 0;
  return round2(0.75 * score + 20);
}

function scoreAsset(asset) {
  const i = asset.inputs;
  const dims = {
    D1_liquidity: scoreD1(i),
    D2_wrapDepth: scoreD2(i),
    D3_bridge: scoreD3(i),
    D4_oracle: scoreD4(i),
    D5_redemption: scoreD5(i),
    D6_duration: scoreD6(i),
    D7_verification: scoreD7(i),
    D8_operational: scoreD8(i),
  };
  let composite = 0;
  for (const k of Object.keys(WEIGHTS)) composite += WEIGHTS[k] * dims[k];
  composite = round2(composite);

  const gates = evaluateGates(i);
  const tier = tierFromScore(composite, gates);
  let effectiveScore = composite;
  if (tier === 'T3' && TIER_SCORE_CEILING.T3 && composite > TIER_SCORE_CEILING.T3
      && gates.some(g => g.effect === 'TIER3_CAP')) {
    effectiveScore = TIER_SCORE_CEILING.T3;
  }
  if (tier === 'T5') effectiveScore = composite; // reported, but ineligible

  return {
    symbol: asset.symbol,
    name: asset.name,
    methodology: METHODOLOGY_VERSION,
    asOf: asset.asOf,
    dimensions: dims,
    composite,
    gates,
    tier,
    score: effectiveScore,
    maxLtvPct: maxLtvFromScore(effectiveScore, tier),
    eligible: tier !== 'T5',
    stepDown: gates.some(g => g.effect === 'STEP_DOWN'),
    inputs: asset.inputs, // Commandment III: inputs ship with the score
    note: asset.note || null,
  };
}

function scoreAll() {
  return Object.values(ASSETS).map(scoreAsset);
}

function clamp(x) { return Math.max(0, Math.min(100, x)); }
function round2(x) { return Math.round(x * 100) / 100; }

// ---------------------------------------------------------------------------
// Reference asset configurations — ILLUSTRATIVE PUBLISHED INPUTS, V1.0 draft.
// Inputs marked asOf with their snapshot date. Live versions should be wired
// to chainlink.js / defillama.js feeds exactly like the RWALS backend.
// ---------------------------------------------------------------------------
const ASSETS = {
  WETH: {
    symbol: 'WETH', name: 'Wrapped Ether', asOf: '2026-06-12',
    inputs: {
      liquidity: { exitCapacityUsd24h: 5e9, slippagePctAtSize: 0.1, independentVenues: 10, largestProtocolPositionUsd: 4e8 },
      wrap: { wrapDepth: 1, parUnwrapPath: true },
      bridge: { bridgedSupply: false, sharedSupplyOFT: false, minVerifiersOnAnyRoute: 99, supplyInvariantMonitored: true },
      oracle: { externalMarketOracle: true, independentProviders: 3, deviationProtection: true, selfReferential: false },
      redemption: { parRedemption: true, permissionless: true, noticeHours: 0, issuerCanPause: false },
      duration: { timeBound: false, daysToMaturity: null, preMaturityParExit: false },
      backing: { backingType: 'native', verification: 'realtime_por' },
      operational: { adminTimelock: true, upgradeable: false, curatorConcentration: 'none', withdrawalFreezeAuthority: false, incidentHistory: false },
    },
  },
  USDC: {
    symbol: 'USDC', name: 'USD Coin', asOf: '2026-06-12',
    inputs: {
      liquidity: { exitCapacityUsd24h: 8e9, slippagePctAtSize: 0.05, independentVenues: 12, largestProtocolPositionUsd: 9e8 },
      wrap: { wrapDepth: 0, parUnwrapPath: true },
      bridge: { bridgedSupply: true, sharedSupplyOFT: false, minVerifiersOnAnyRoute: 3, supplyInvariantMonitored: true },
      oracle: { externalMarketOracle: true, independentProviders: 3, deviationProtection: true, selfReferential: false },
      redemption: { parRedemption: true, permissionless: false, noticeHours: 24, issuerCanPause: true },
      duration: { timeBound: false, daysToMaturity: null, preMaturityParExit: false },
      backing: { backingType: 'offchain', verification: 'recurring_independent' },
      operational: { adminTimelock: true, upgradeable: true, curatorConcentration: 'none', withdrawalFreezeAuthority: true, incidentHistory: false },
    },
  },
  WSTETH: {
    symbol: 'wstETH', name: 'Wrapped Staked Ether (Lido)', asOf: '2026-06-12',
    note: 'Exchange-rate oracle dependency priced under D4; misalignment incident in test suite.',
    inputs: {
      liquidity: { exitCapacityUsd24h: 1.5e9, slippagePctAtSize: 0.3, independentVenues: 6, largestProtocolPositionUsd: 5e8 },
      wrap: { wrapDepth: 2, parUnwrapPath: true },
      bridge: { bridgedSupply: false, sharedSupplyOFT: false, minVerifiersOnAnyRoute: 99, supplyInvariantMonitored: true },
      oracle: { externalMarketOracle: true, independentProviders: 2, deviationProtection: true, selfReferential: false },
      redemption: { parRedemption: true, permissionless: true, noticeHours: 72, issuerCanPause: false },
      duration: { timeBound: false, daysToMaturity: null, preMaturityParExit: false },
      backing: { backingType: 'onchain', verification: 'realtime_por' },
      operational: { adminTimelock: true, upgradeable: true, curatorConcentration: 'none', withdrawalFreezeAuthority: false, incidentHistory: true },
    },
  },
  RSETH: {
    symbol: 'rsETH', name: 'Kelp Restaked ETH — scored as configured at Aave listing', asOf: '2026-04-17',
    note: 'BACKTEST. Aave parameters at the time: 93% LTV / 95% LT (eMode). CRS verdict on the same day: Gate G2, INELIGIBLE.',
    inputs: {
      liquidity: { exitCapacityUsd24h: 3e8, slippagePctAtSize: 1.2, independentVenues: 4, largestProtocolPositionUsd: 2.2e8 },
      wrap: { wrapDepth: 3, parUnwrapPath: false },
      bridge: { bridgedSupply: true, sharedSupplyOFT: true, minVerifiersOnAnyRoute: 1, supplyInvariantMonitored: false },
      oracle: { externalMarketOracle: true, independentProviders: 1, deviationProtection: false, selfReferential: false },
      redemption: { parRedemption: true, permissionless: true, noticeHours: 168, issuerCanPause: true },
      duration: { timeBound: false, daysToMaturity: null, preMaturityParExit: false },
      backing: { backingType: 'onchain', verification: 'quarterly_audit' },
      operational: { adminTimelock: true, upgradeable: true, curatorConcentration: 'none', withdrawalFreezeAuthority: false, incidentHistory: false },
    },
  },
  WRSETH: {
    symbol: 'wrsETH', name: 'Bridged rsETH (L2) — scored as listed', asOf: '2026-04-17',
    note: 'BACKTEST. Fourth wrap layer over a compromised shared supply. Gates G1 + G2.',
    inputs: {
      liquidity: { exitCapacityUsd24h: 6e7, slippagePctAtSize: 2.5, independentVenues: 2, largestProtocolPositionUsd: 9e7 },
      wrap: { wrapDepth: 4, parUnwrapPath: false },
      bridge: { bridgedSupply: true, sharedSupplyOFT: true, minVerifiersOnAnyRoute: 1, supplyInvariantMonitored: false },
      oracle: { externalMarketOracle: false, independentProviders: 1, deviationProtection: false, selfReferential: true },
      redemption: { parRedemption: false, permissionless: false, noticeHours: 999, issuerCanPause: true },
      duration: { timeBound: false, daysToMaturity: null, preMaturityParExit: false },
      backing: { backingType: 'onchain', verification: 'self_reported' },
      operational: { adminTimelock: false, upgradeable: true, curatorConcentration: 'none', withdrawalFreezeAuthority: false, incidentHistory: false },
    },
  },
  PT_SUSDE: {
    symbol: 'PT-sUSDe', name: 'Pendle Principal Token, sUSDe (illustrative 120-day maturity)', asOf: '2026-06-12',
    note: 'Gate G4 cap: linear-discount oracle with no external market check. Duration scored under D6.',
    inputs: {
      liquidity: { exitCapacityUsd24h: 5e7, slippagePctAtSize: 1.8, independentVenues: 1, largestProtocolPositionUsd: 1.5e8 },
      wrap: { wrapDepth: 3, parUnwrapPath: false },
      bridge: { bridgedSupply: false, sharedSupplyOFT: false, minVerifiersOnAnyRoute: 99, supplyInvariantMonitored: true },
      oracle: { externalMarketOracle: false, independentProviders: 0, deviationProtection: false, selfReferential: true },
      redemption: { parRedemption: true, permissionless: true, noticeHours: 0, issuerCanPause: false },
      duration: { timeBound: true, daysToMaturity: 120, preMaturityParExit: false },
      backing: { backingType: 'onchain', verification: 'realtime_por' },
      operational: { adminTimelock: true, upgradeable: true, curatorConcentration: 'none', withdrawalFreezeAuthority: false, incidentHistory: false },
    },
  },
  PAXG: {
    symbol: 'PAXG', name: 'Pax Gold', asOf: '2026-06-12',
    note: 'Continuity with RWALS coverage. NYDFS-regulated; monthly attestations.',
    inputs: {
      liquidity: { exitCapacityUsd24h: 4e8, slippagePctAtSize: 0.4, independentVenues: 5, largestProtocolPositionUsd: 6e7 },
      wrap: { wrapDepth: 1, parUnwrapPath: true },
      bridge: { bridgedSupply: false, sharedSupplyOFT: false, minVerifiersOnAnyRoute: 99, supplyInvariantMonitored: true },
      oracle: { externalMarketOracle: true, independentProviders: 2, deviationProtection: true, selfReferential: false },
      redemption: { parRedemption: true, permissionless: false, noticeHours: 48, issuerCanPause: true },
      duration: { timeBound: false, daysToMaturity: null, preMaturityParExit: false },
      backing: { backingType: 'physical', verification: 'recurring_independent' },
      operational: { adminTimelock: true, upgradeable: true, curatorConcentration: 'none', withdrawalFreezeAuthority: true, incidentHistory: false },
    },
  },
  SBUIDL: {
    symbol: 'sBUIDL', name: 'Securitize BUIDL (staked wrapper)', asOf: '2026-06-12',
    inputs: {
      liquidity: { exitCapacityUsd24h: 1.2e8, slippagePctAtSize: 0.8, independentVenues: 2, largestProtocolPositionUsd: 5e7 },
      wrap: { wrapDepth: 2, parUnwrapPath: true },
      bridge: { bridgedSupply: false, sharedSupplyOFT: false, minVerifiersOnAnyRoute: 99, supplyInvariantMonitored: true },
      oracle: { externalMarketOracle: true, independentProviders: 1, deviationProtection: true, selfReferential: false },
      redemption: { parRedemption: true, permissionless: false, noticeHours: 24, issuerCanPause: true },
      duration: { timeBound: false, daysToMaturity: null, preMaturityParExit: false },
      backing: { backingType: 'offchain', verification: 'recurring_independent' },
      operational: { adminTimelock: true, upgradeable: true, curatorConcentration: 'none', withdrawalFreezeAuthority: true, incidentHistory: false },
    },
  },
  JTRSY: {
    symbol: 'JTRSY', name: 'Centrifuge Janus Henderson Treasury Fund Token', asOf: '2026-06-12',
    inputs: {
      liquidity: { exitCapacityUsd24h: 8e7, slippagePctAtSize: 1.0, independentVenues: 2, largestProtocolPositionUsd: 4e7 },
      wrap: { wrapDepth: 1, parUnwrapPath: true },
      bridge: { bridgedSupply: true, sharedSupplyOFT: false, minVerifiersOnAnyRoute: 3, supplyInvariantMonitored: true },
      oracle: { externalMarketOracle: true, independentProviders: 1, deviationProtection: false, selfReferential: false },
      redemption: { parRedemption: true, permissionless: false, noticeHours: 48, issuerCanPause: true },
      duration: { timeBound: false, daysToMaturity: null, preMaturityParExit: false },
      backing: { backingType: 'offchain', verification: 'recurring_independent' },
      operational: { adminTimelock: true, upgradeable: true, curatorConcentration: 'none', withdrawalFreezeAuthority: true, incidentHistory: false },
    },
  },
  CURATED_VAULT: {
    symbol: 'cvUSDC', name: 'Curated USDC Vault Share (generic, single curator)', asOf: '2026-06-12',
    note: 'Generic profile for single-curator vault shares. D8 prices freeze authority and curator concentration BEFORE listing.',
    inputs: {
      liquidity: { exitCapacityUsd24h: 3e7, slippagePctAtSize: 0.5, independentVenues: 1, largestProtocolPositionUsd: 2.5e7 },
      wrap: { wrapDepth: 2, parUnwrapPath: true },
      bridge: { bridgedSupply: false, sharedSupplyOFT: false, minVerifiersOnAnyRoute: 99, supplyInvariantMonitored: true },
      oracle: { externalMarketOracle: false, independentProviders: 1, deviationProtection: false, selfReferential: true },
      redemption: { parRedemption: true, permissionless: true, noticeHours: 0, issuerCanPause: true },
      duration: { timeBound: false, daysToMaturity: null, preMaturityParExit: false },
      backing: { backingType: 'onchain', verification: 'realtime_por' },
      operational: { adminTimelock: false, upgradeable: true, curatorConcentration: 'single', withdrawalFreezeAuthority: true, incidentHistory: false },
    },
  },
};

module.exports = { scoreAsset, scoreAll, ASSETS, WEIGHTS, METHODOLOGY_VERSION };

// Standalone run: node crs-scorer.js
if (require.main === module) {
  for (const r of scoreAll()) {
    const gateStr = r.gates.length ? ' [' + r.gates.map(g => g.gate).join('+') + ']' : '';
    console.log(
      `${r.symbol.padEnd(10)} score ${String(r.score).padStart(6)}  tier ${r.tier}` +
      `  maxLTV ${String(r.maxLtvPct).padStart(5)}%  ${r.eligible ? 'ELIGIBLE' : 'INELIGIBLE'}${gateStr}`
    );
  }
}
