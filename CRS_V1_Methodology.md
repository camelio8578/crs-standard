# CRS — The Collateral Risk Standard
## Version 1.0 — Open Methodology

**A sister standard to RWALS (Real World Asset Liquidity Score)**
**Status: Public Draft for Comment**
**License: Open. The methodology is free, forever.**

---

## 1. Purpose

In the twelve months ending June 2026, the four largest open lending ecosystems suffered the same failure in four different costumes:

- **Aave** absorbed an estimated one hundred twenty-three to two hundred thirty million dollars in bad debt when rsETH — a token wrapped four layers deep and bridged over a single-attestor route — was underwritten at 93% loan-to-value, the same as native ETH.
- **Euler** users lost funds in the Elixir and Steam Labs collapse, where curated assets failed with no standardized monitoring, and risk stewards spend every month manually grinding parameter updates across dozens of expiring instruments.
- **Morpho** depositors discovered that "curated" vaults can freeze withdrawals, and that oracle deviation is handled by ad-hoc timelocks rather than a standard.
- **Centrifuge** participants identified that no oracle anywhere proves a physical asset actually exists and matches its on-chain representation.

These are not four problems. They are one problem: **collateral is admitted on judgment, monitored by nobody, and repriced only after the loss.**

CRS replaces judgment with a published, deterministic, reproducible score — and replaces committee repricing with continuous monitoring and automatic parameter response.

CRS is the sister standard to RWALS. RWALS scores the liquidity of tokenized real-world assets. CRS scores the safety of **anything pledged as collateral** — liquid staking tokens, restaked tokens, bridged assets, principal tokens, stablecoins, RWA tokens, and curated vault shares — under one transparent methodology.

---

## 2. The Score

Every asset receives a **CRS Score from 0 to 100**, where higher is safer. The score is a weighted composite of eight dimensions, subject to five hard gates that cannot be averaged away.

### 2.1 The Eight Dimensions

| # | Dimension | Weight | The failure it prices |
|---|-----------|--------|----------------------|
| D1 | Liquidity Depth & Exit Capacity | 20% | Can the protocol actually liquidate this at scale? (RWALS DNA: depth, venues, slippage at size, time-to-exit) |
| D2 | Wrap & Rehypothecation Depth | 15% | Every wrapper is a new way to die. rsETH reached Aave wrapped four times; the outermost wrap is what broke. |
| D3 | Bridge & Cross-Chain Exposure | 12% | Shared-supply OFT tokens inherit the weakest verification path on any chain. Kelp's Unichain route was a 1-of-1 DVN. |
| D4 | Oracle Integrity | 13% | Self-referential pricing (internal exchange rates, linear discount models) failed on wstETH and prices Pendle PTs today with no external market check. |
| D5 | Redemption Posture | 12% | Is there a par redemption path, at what notice, gated by whom? AMM-only exits are not redemption. |
| D6 | Duration Risk | 8% | Time-bound instruments (PTs) carry maturity risk that spot collateral does not. A 14-day PT and a 365-day PT are not the same asset. |
| D7 | Backing Verification | 12% | Who independently verified the backing exists — reserves, custody, or the physical asset itself? MANTRA and Tangible/USDR are the price of "trust us." |
| D8 | Operational & Governance Risk | 8% | Curator track record, admin keys, upgrade powers, regulatory posture, withdrawal-freeze authority. |

Each dimension is scored 0–100 from published, checkable sub-criteria (Section 4). The composite is:

```
CRS = 0.20·D1 + 0.15·D2 + 0.12·D3 + 0.13·D4 + 0.12·D5 + 0.08·D6 + 0.12·D7 + 0.08·D8
```

### 2.2 The Five Hard Gates

A high composite must never launder a fatal flaw. The following conditions override the composite:

| Gate | Condition | Effect |
|------|-----------|--------|
| G1 | Effective wrap depth ≥ 4 layers | **INELIGIBLE** as collateral |
| G2 | Any live bridge route securing the asset's supply is verified by a single attestor (e.g., 1-of-1 DVN) | **INELIGIBLE** as collateral on every chain sharing that supply |
| G3 | Physical or off-chain backing with no independent, recurring verification | Capped at **Tier 3** regardless of composite |
| G4 | Price oracle is self-referential with no external market check | Capped at **Tier 3** regardless of composite |
| G5 | Time-to-maturity under 30 days | Automatic weekly LTV step-down to zero at maturity |

Gate G1 and G2, applied retroactively, classify rsETH and wrsETH as ineligible **on the day Aave listed them at 93% LTV.** That is the standard's proof of work.

### 2.3 Tiers and the Continuous Parameter Map

Scores map to tiers for communication, but **parameters are continuous** — no cliff effects between adjacent scores (a documented flaw in bucket-based frameworks):

```
Maximum LTV (%) = 0.75 × CRS + 20        for CRS ≥ 40
Maximum LTV (%) = 0 (ineligible)          for CRS < 40 or any fatal gate
```

| Tier | Score | Max LTV (by formula) | Meaning |
|------|-------|----------------------|---------|
| T1 | 85–100 | 83.75% – 95% | Core collateral |
| T2 | 70–84 | 72.5% – 83% | Standard collateral |
| T3 | 55–69 | 61.25% – 71.75% | Restricted: supply caps required |
| T4 | 40–54 | 50% – 60.5% | Exit-only: no new collateral positions |
| T5 | 0–39 or gated | 0% | Ineligible |

Protocols remain sovereign: CRS publishes the ceiling, governance may always set parameters *below* it. CRS never tells a protocol to take more risk — only where the standard says risk ends.

---

## 3. Continuous Monitoring & Circuit Breakers

A score that updates quarterly is a press release. CRS scores are **living**:

- **Monitored inputs:** on-chain liquidity depth, oracle deviation vs. external markets, bridge route configuration, supply invariants (locked ≥ minted across chains), redemption queue status, verification attestation freshness, time-to-maturity.
- **Automatic downgrade triggers** (each ships with its evidence, on the record):
  - Supply invariant violation on any chain → instant G2-equivalent ineligibility flag
  - Oracle deviation > 2% from external reference for > 1 hour → D4 marked to floor
  - Liquidity depth drops > 50% from trailing 30-day average → D1 re-scored same day
  - Verification attestation expires → G3 applies
  - Maturity enters 30-day window → G5 schedule begins
- **No automatic upgrades.** Scores go down by machine, and up only by published review. Risk is asymmetric; so is the standard.

This directly replaces the monthly manual parameter-update grind documented across Euler governance, and the ad-hoc deviation timelocks improvised on Morpho.

---

## 4. Dimension Scoring Rubrics (Summary)

Full sub-criteria tables are published with the reference implementation. Summary anchors:

**D1 Liquidity (20%).** 100: > $500M exit capacity within 24h at < 1% slippage across ≥ 3 independent venues. 50: exit capacity ≥ 2× the largest protocol-wide collateral position. 0: AMM-only exit thinner than open collateral positions against it.

**D2 Wrap Depth (15%).** 100: native asset (0 wraps). 75: one wrap with par unwrap path (e.g., wstETH→stETH). 45: two wraps. 20: three wraps. Gate at four.

**D3 Bridge Exposure (12%).** 100: no bridged supply, or burn-and-mint with ≥ 3 independent verifiers on every route. 50: shared-supply OFT with multi-DVN on all routes. Gate: any 1-of-1 route anywhere in the supply graph.

**D4 Oracle Integrity (13%).** 100: multiple independent external market oracles with deviation protection. 60: external oracle, single provider. Gate-capped: internal exchange rate or model price only.

**D5 Redemption (12%).** 100: permissionless par redemption, ≤ 24h, no gate-keeper. 60: par redemption with notice period or KYC. 30: redemption pausable by issuer. 0: no redemption right; secondary market only.

**D6 Duration (8%).** 100 for all non-expiring assets. Time-bound assets: scored on maturity distance, roll mechanics, and the existence of a pre-maturity par exit (a pre-maturity exit at par scores credit here; an AMM exit does not).

**D7 Backing Verification (12%).** 100: real-time on-chain proof of reserves, or for physical assets, recurring independent attestation (inspection, photogrammetry, hardware-attested evidence) published on a fixed cadence. 50: periodic third-party audit, ≥ quarterly. 0: issuer self-reporting.

**D8 Operational & Governance (8%).** Scored on: admin key configuration and timelocks, upgradeability scope, curator track record and concentration, withdrawal-freeze authority, regulatory posture, incident history.

---

## 5. The Ten Commandments of CRS

The governance constitution. These are not values; they are constraints. Any party may verify compliance with every one of them, and any violation voids the standard's claim to neutrality.

**I. The methodology shall be public, complete, and free — forever.**
No black box, no premium tier of truth. The full rubric, weights, gates, and reference implementation are open source in perpetuity.

**II. No issuer, protocol, or curator shall ever pay for a score.**
The ratings-agency conflict — graded by the graded — caused 2008 and it will not be rebuilt here. Scores cannot be bought, expedited, or sponsored.

**III. Every score shall be reproducible by anyone, from published inputs.**
Each score ships with its complete input set. Run the open scorer on the published inputs and you get the published score, bit for bit. If you cannot reproduce it, the score is invalid.

**IV. No strength shall hide a weakness.**
Hard gates exist because averages launder fatal flaws. A perfect liquidity score does not excuse a 1-of-1 bridge. Gates are never waived, for any asset, for any reason.

**V. Scores shall change when reality changes — not when committees meet.**
Monitoring is continuous and downgrades are automatic. The standard does not wait for a governance call to acknowledge a fact.

**VI. Every downgrade shall ship with its evidence.**
Trigger, timestamp, data source, and the exact rubric line invoked — published at the moment of the change, on the record, permanently.

**VII. Disputes shall be heard in public and resolved on the record.**
Any issuer or community may challenge a score. The challenge, the evidence, and the ruling are published. Nothing is settled in private.

**VIII. No single party — including the author — shall hold the power to bend a score.**
Capture resistance is by governance design: methodology changes require public proposal, public comment, and versioned publication. There is no override key.

**IX. The standard is free; only the rails are paid.**
Sustainability without corruption: the methodology and scores are public goods. Revenue comes solely from delivery infrastructure — API access, on-chain oracle feeds, integration support — never from the scores themselves.

**X. Every failure becomes a factor.**
Each post-mortem in the industry must be expressible in the standard — scored retroactively, with the standard catching what was missed — or the standard amends itself in public. CRS V1.0 is backtested against rsETH, wrsETH, the Elixir/Steam Labs collapse, the wstETH exchange-rate misalignment, and Tangible/USDR. Every future incident joins the test suite.

---

## 6. Backtest: The Proof of Work

| Incident | What the protocol did | What CRS V1.0 says, on listing day |
|----------|----------------------|-------------------------------------|
| rsETH on Aave (Apr 2026) | 93% LTV / 95% LT in eMode | **Gate G2: INELIGIBLE.** Supply secured by a 1-of-1 DVN route (Unichain). Composite irrelevant. |
| wrsETH on L2s | Listed as standard LST collateral | **Gates G1 + G2: INELIGIBLE.** Fourth wrap layer, shared compromised supply. |
| PT-sUSDe on lending markets | LTV ≥ 90% in practice | **Gate G4 cap: Tier 3 maximum.** Self-referential discount-model oracle; AMM-only practical exit; plus D6 duration scoring. |
| Tangible / USDR | Treated as verified RWA backing | **Gate G3 cap: Tier 3 maximum.** No recurring independent verification of physical backing. |
| Curated vault freezes (Morpho), Elixir/Steam (Euler) | Discovered by depositors after the fact | **D8 + monitoring:** withdrawal-freeze authority and curator concentration are scored before listing; freeze events trigger same-day automatic downgrade with published evidence. |

---

## 7. Delivery & Integration

- **Free, forever:** methodology, rubrics, published scores and their full input sets, the reference scorer.
- **Paid rails (Commandment IX):** real-time API (the same stack as RWALS: Node/Express, live Chainlink and DefiLlama inputs), push webhooks for downgrade triggers, and an on-chain score oracle that risk stewards and curators can read directly — enabling score-driven parameter automation instead of monthly manual updates.
- **Protocol integration pattern:** governance adopts the CRS ceiling formula by vote once; thereafter parameters track scores automatically within governance-set bounds. Governance keeps the brake; the standard provides the speedometer.

---

## 8. Versioning & Amendment

This is V1.0, a public draft for comment. Amendments follow Commandment VIII: public proposal → open comment window → versioned publication with a complete changelog. Scores are always tagged with the methodology version that produced them. No silent changes, ever.

---

*CRS is published by the author of RWALS as an open standard. RWALS scores the liquidity of tokenized real-world assets; CRS scores the safety of all collateral. The two standards share one constitution: transparent, reproducible, capture-resistant, free.*
