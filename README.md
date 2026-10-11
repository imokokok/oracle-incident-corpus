# Oracle Incident Corpus

A structured, versioned, provenance-carrying corpus of **oracle / price-feed root-cause incidents** in DeFi (2019-06 → 2026-03). Maintained by [Insight](https://oracleinsight.xyz).

**v1.0.0** — 15 entries, every entry carries a source tier and a machine-checkable verdict on its loss figure:

| Verdict | Count | Meaning |
|---|---|---|
| `confirmed` | 2 | Loss figure recomputed on-chain, matches the recorded range |
| `token-confirmed` | 1 | Per-token amounts match to the digit; USD value needs interpretation |
| `refined` | 1 | Recomputed figure replaces the secondary-source range as the tighter estimate |
| `partial` | 3 | Mechanism and magnitude confirmed; profits flowed out beyond the recorded tx set |
| `flagged` | 1 | Recompute conflicts >2× with the secondary range — **do not cite before arbitration** |
| `none-applicable` | 7 | No attacker tx (feed misconfiguration / upstream failure / non-EVM), secondary or official-disclosure figure retained |

The recompute itself (tx-receipt log-level token flows + native balance diff + at-attack-block pricing) is reproducible from this repo — see [RECOMPUTE-V1.md](RECOMPUTE-V1.md).

## What is in here

- **`incidents.v0.yaml`** — the corpus. 15 records with root-cause class, loss estimate (nominal vs realized where known), attack cost where available, on-chain evidence (tx hashes, block timestamps), and tiered sources. All 15 entries are multi-source or better; zero single-source.
- **`SCHEMA.md`** — field definitions, the root-cause taxonomy, and evolution discipline.
- **`corpus-attestation.v1.json`** + **`issuer-public.pem`** — Ed25519 attestation pinning the exact bytes of `incidents.v0.yaml` (sha256 `ea8411cd…`, 42,415 bytes).
- **`verify-corpus.mjs`** — independent verifier (zero dependencies, Node ≥ 18).
- **`validate.mjs`** — structural lint (required fields, enums, id uniqueness, source-tier discipline).
- **`scripts/recompute-v1.mjs`**, **`scripts/analyze-v1.mjs`** — the recompute pipeline (JSON-RPC receipts → per-address ERC-20 flows + native balance diffs → DefiLlama at-block pricing).
- **`data/recompute-raw.json`**, **`data/recompute-priced.json`** — the raw and priced recompute outputs.

## Verify the attestation

```sh
node verify-corpus.mjs
```

Exit 0 = the yaml is byte-identical to what was signed and the signature is valid. Any later change to the yaml invalidates the attestation by design — corpus changes require re-signing.

**Trust root disclosure:** this is a self-issued attestation. The attached `issuer-public.pem` *is* the trust root: the signature proves "the file has not changed since signing", not "who the signer is". Upgrade path: pin the issuer key in a published well-known registry before any external reliance.

## Reproduce the amount recompute

```sh
node scripts/recompute-v1.mjs   # pulls receipts/flows via public RPCs (drpc, cloudflare, publicnode, ankr)
node scripts/analyze-v1.mjs     # prices flows via DefiLlama historical API at the attack block
```

Outputs are already committed under `data/` for comparison.

## Known limitations (stated, not hidden)

1. `tx-hash-chain-verified` proves the attack happened on that date (tx exists + block timestamp). The **amount** verdicts above are the on-chain component: `confirmed` / `token-confirmed` / `refined` are recomputed; `partial` is magnitude-only; `none-applicable` entries keep their secondary / official-disclosure figures.
2. The **`2024-06-10-uwu-lend`** entry is `flagged`: the recomputed beneficiary flow (~$46M at attack-block prices) exceeds the secondary range ($19.3–20.3M) by more than 2×. Candidate explanations (secondary-source undercount / manipulated pool distorts at-block pricing / asset semantics) are listed in [RECOMPUTE-V1.md](RECOMPUTE-V1.md). **Do not cite this entry's amount until arbitrated.**
3. `loss_usd_estimate` is nominal unless the entry states otherwise. Nominal and realized often differ by 1–2 orders of magnitude (BonqDAO: ~$120M nominal vs ~$1.2–1.6M realized — with the on-chain token flows to show for it).
4. Record prose and notes are written in **Chinese**; structured fields are English. A translated edition is planned for v1.1.
5. The taxonomy (10 classes over 15 entries) may be overfit at this corpus size; it converges at 30+ entries.
6. This is not the first structured hack database (see iTokenly Hack Registry, CC BY 4.0). The differentiation: oracle-only curation (including non-attacker entries: feed misconfigurations, upstream failures), an `attack_cost` field (what it *cost to move the price*), nominal-vs-realized separation, and signed provenance.

## License

Corpus data: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Scripts: MIT.
