#!/usr/bin/env node
/**
 * analyze-v1.mjs — 复算第二阶段：token 识别 + 历史价计价
 *
 * 输入 data/recompute-raw.json → 输出 data/recompute-priced.json
 * 价格源：DefiLlama coins API（prices.historical，返回 symbol/decimals/price，
 * 按 token 合约查询，无需 key）；原生 ETH 用 coingecko:ethereum。
 * 诚实边界：price = 攻击块时间点的 llama 口径；WALBT 类无流动性代币可能无价 → null。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(DIR, '..', 'data', 'recompute-raw.json'), 'utf8'));

const CHAIN_PREFIX = { ethereum: 'ethereum', polygon: 'polygon', arbitrum: 'arbitrum' };

async function llamaHistorical(ts, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const url = `https://coins.llama.fi/prices/historical/${ts}/${batch.join(',')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`llama http ${res.status}`);
    const j = await res.json();
    Object.assign(out, j.coins ?? {});
    await new Promise((r) => setTimeout(r, 1200));
  }
  return out;
}

async function main() {
  const results = [];
  for (const inc of raw) {
    const prefix = CHAIN_PREFIX[inc.chain];
    const ts = inc.txs.find((t) => !t.error)?.block_ts;
    const entry = { id: inc.id, chain: inc.chain, attacker_effective: inc.attacker_effective, txs: [], native: inc.native_balance_diff ?? {} };

    // 收集 token 地址
    const tokens = new Set();
    for (const t of inc.txs) for (const tok of Object.keys(t.erc20_flows ?? {})) tokens.add(tok);
    if (!ts) { entry.error = 'no successful tx'; results.push(entry); continue; }

    let priceMap = {};
    if (tokens.size) {
      const ids = [...tokens].map((a) => `${prefix}:${a}`);
      ids.push('coingecko:ethereum');
      try { priceMap = await llamaHistorical(ts, ids); }
      catch (e) { entry.price_error = e.message; }
    } else {
      try { priceMap = await llamaHistorical(ts, ['coingecko:ethereum']); } catch (e) { entry.price_error = e.message; }
    }
    const ethPrice = priceMap['coingecko:ethereum']?.price ?? null;
    entry.eth_price_usd = ethPrice;

    // attacker 相关地址的净流（含人读单位与 USD）
    const attackers = new Set((inc.attacker_effective ?? []).map((a) => a.toLowerCase()));
    const netByToken = new Map(); // token -> raw net sum over attacker addresses
    for (const t of inc.txs) {
      t.priced_flows = {};
      for (const [token, perAddr] of Object.entries(t.erc20_flows ?? {})) {
        const meta = priceMap[`${prefix}:${token}`];
        let net = 0n;
        const detail = {};
        for (const [addr, v] of Object.entries(perAddr)) {
          const bi = BigInt(v);
          if (attackers.has(addr)) { net += bi; detail[addr] = bi.toString(); }
        }
        if (Object.keys(detail).length === 0) continue;
        const dec = meta?.decimals ?? 18;
        const human = Number(net) / 10 ** dec;
        const usd = meta?.price != null ? human * meta.price : null;
        t.priced_flows[token] = {
          symbol: meta?.symbol ?? '?', decimals: dec, price_usd: meta?.price ?? null,
          attacker_net_raw: net.toString(), attacker_net_human: human, attacker_net_usd: usd,
          detail,
        };
        netByToken.set(token, (netByToken.get(token) ?? 0n) + net);
      }
    }

    // 全窗口聚合：按 attacker 地址分别聚合（避免中间合约互抵），另存合计
    entry.attacker_window_aggregate = {};   // 合计（保留兼容）
    entry.attacker_per_address = {};        // 逐地址
    let totalUsd = 0, pricedUsd = 0;
    for (const [token, net] of netByToken) {
      const meta = priceMap[`${prefix}:${token}`];
      const dec = meta?.decimals ?? 18;
      const human = Number(net) / 10 ** dec;
      const usd = meta?.price != null ? human * meta.price : null;
      entry.attacker_window_aggregate[token] = {
        symbol: meta?.symbol ?? '?', decimals: dec, price_usd: meta?.price ?? null,
        net_raw: net.toString(), net_human: human, net_usd: usd,
      };
      if (usd != null) { totalUsd += usd; pricedUsd += usd; }
    }
    const mergedFlows = {}; // token -> addr -> net raw string
    for (const t of inc.txs) {
      for (const [tok, per] of Object.entries(t.erc20_flows ?? {})) {
        mergedFlows[tok] ??= {};
        for (const [a, v] of Object.entries(per)) {
          mergedFlows[tok][a] = (BigInt(mergedFlows[tok][a] ?? '0') + BigInt(v)).toString();
        }
      }
    }
    for (const addr of attackers) {
      const agg = {};
      for (const [token, perAddr] of Object.entries(mergedFlows)) {
        const v = perAddr[addr];
        if (v === undefined) continue;
        const meta = priceMap[`${prefix}:${token}`];
        const dec = meta?.decimals ?? 18;
        const human = Number(BigInt(v)) / 10 ** dec;
        const usd = meta?.price != null ? human * meta.price : null;
        agg[token] = { symbol: meta?.symbol ?? '?', net_raw: v, net_human: human, net_usd: usd };
      }
      if (Object.keys(agg).length) entry.attacker_per_address[addr] = agg;
    }
    // 原生 ETH 差分计入
    let nativeUsd = 0;
    for (const [addr, b] of Object.entries(entry.native)) {
      if (b.delta_wei == null) continue;
      const eth = Number(BigInt(b.delta_wei)) / 1e18;
      b.delta_eth = eth;
      if (ethPrice != null) { b.delta_usd = eth * ethPrice; nativeUsd += b.delta_usd; }
    }
    entry.total_net_usd_erc20 = totalUsd;
    entry.total_net_usd_with_native = totalUsd + nativeUsd;
    results.push(entry);
    console.error(`priced: ${inc.id} (erc20 $${totalUsd.toFixed(0)}, +native $${nativeUsd.toFixed(0)})`);
  }
  writeFileSync(join(DIR, '..', 'data', 'recompute-priced.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('written: data/recompute-priced.json');
}
main().catch((e) => { console.error(e); process.exit(1); });
