#!/usr/bin/env node
/**
 * recompute-v1.mjs — 语料库 v1 金额链上复算（日志级 + 原生币余额差分）
 *
 * 方法：
 *  1. 每个攻击 tx 拉 receipt（publicnode/drpc/llamarpc/ankr failover）；
 *  2. 解析 ERC-20 Transfer 日志（topic0 ddf252ad…），聚合 attacker 地址的净流入/流出（原始单位）；
 *  3. attacker 原生 ETH 用 eth_getBalance 在攻击窗口前后差分；
 *  4. 块时间戳记录，供 DefiLlama 历史价计价（第二阶段）。
 *
 * 诚实边界：只复算"攻击 tx 内/紧后窗口的资产流出（token 级）"，
 * realized（后续卖出变现）与追回仍保留二手/官方口径并分层标注。
 *
 * 用法：node scripts/recompute-v1.mjs   （产出 data/recompute-raw.json）
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, '..', 'data', 'recompute-raw.json');
mkdirSync(dirname(OUT), { recursive: true });

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const RPCS = {
  ethereum: ['https://eth.drpc.org', 'https://cloudflare-eth.com', 'https://ethereum-rpc.publicnode.com'],
  polygon: ['https://polygon.drpc.org', 'https://polygon-rpc.com', 'https://1rpc.io/matic', 'https://polygon-bor-rpc.publicnode.com'],
  arbitrum: ['https://arbitrum.drpc.org', 'https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
};

const INCIDENTS = [
  {
    id: '2020-10-26-harvest-finance', chain: 'ethereum', include_to: true,
    attacker: ['0xf224ab004461540778a914ea397c589b677e27bb'],
    txs: [{ hash: '0x35f8d2f572fceaac9288e5d462117850ef2694786992a8c3f6d02612277b0877', note: 'recorded main attack tx' }],
  },
  {
    id: '2023-02-01-bonqdao', chain: 'polygon', include_to: true,
    attacker: ['0xcacf2d28b2a5309e099f0c6e8c60ec3ddf656642'],
    txs: [
      { hash: '0x31957ecc43774d19f54d9968e95c69c882468b46860f921668f2c55fadd51b19', note: 'mint 100M BEUR against pumped WALBT' },
      { hash: '0xa02d0c3d16d6ee0e0b6a42c3cc91997c2b40c87d777136dedebe8ee0f47f32b1', note: 'dump price + liquidate troves' },
    ],
  },
  {
    id: '2024-06-10-uwu-lend', chain: 'ethereum', include_to: true,
    attacker: ['0xed1521ee1558af6087ad6bc6790ba1ee2a4174ec'],  // 2026-10-12 第一轮推导：本 tx 最大净流入外部地址
    txs: [{ hash: '0xca1bbf3b320662c89232006f1ec6624b56242850f07e0f1dadbe4f69ba0d6ac3', note: 'first of 3 attack txs (6 min window)' }],
  },
  {
    id: '2021-10-27-cream-finance', chain: 'ethereum', include_to: true,
    attacker: ['0x24354d31bc9d90f62fe5f2454709c32049cf866b'],
    txs: [{ hash: '0x0fe2542079644e107cbf13690eb9c2c65963ccb79089ff96bfaf8dced2331c92', note: 'recursive inflate + borrow' }],
  },
  {
    id: '2022-04-02-inverse-finance', chain: 'ethereum', include_to: true,
    attacker: ['0x117c0391b3483e32aa665b5ecb2cc539669ea7e9', '0x8b4c1083cd6aef062298e1fa900df9832c8351b3'],
    txs: [
      { hash: '0x20a6dcff06a791a7f8be9f423053ce8caee3f9eecc31df32445fc98d4ccd8365', note: 'price manipulation + oracle update' },
      { hash: '0x600373f67521324c8068cfd025f121a0843d57ec813411661b07edc5ff781842', note: 'borrow against inflated xINV' },
    ],
  },
  {
    id: '2023-06-12-sturdy-finance', chain: 'ethereum', include_to: true,
    attacker: ['0x1e8419e724d51e87f78e222d935fbbdeb631a08b'],
    txs: [{ hash: '0xeb87ebc0a18aca7d2a9ffcabf61aa69c9e8d3c6efade9e2303f8857717fb9eb7', note: 'flashloan + read-only reentrancy exploit' }],
  },
  {
    id: '2024-03-05-woofi', chain: 'arbitrum', include_to: false,  // tx.to = WooPPv2 受害池，禁入集合
    attacker: ['0x9961190b258897bca7a12b8f37f415e689d281c4'],
    txs: [{ hash: '0xe80a16678b5008d5be1484ec6e9e77dc6307632030553405863ffb38c1f94266', note: 'sPMM formula exploit' }],
  },
  {
    id: '2026-03-22-resolv', chain: 'ethereum', include_to: false,  // tx.to = Resolv 完成合约，禁入集合
    attacker: ['0x15cad41e6bdcad7121ce65080489c92cf6de398'],
    txs: [
      { hash: '0xfe37f25efd67d0a4da4afe48509b258df48757b97810b28ce4c649658dc33743', note: 'first completeSwap tx' },
      { hash: '0x41b6b9376d174165cbd54ba576c8f6675ff966f17609a7b80d27d8652db1f18f', note: 'second completeSwap tx' },
    ],
  },
];

async function rpc(chain, method, params, tries = 3, expectNonNull = false) {
  let lastErr;
  for (const url of RPCS[chain]) {
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 1e6, method, params }),
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
        const j = await res.json();
        if (j.error) throw new Error(`rpc: ${j.error.message}`);
        if (expectNonNull && (j.result === null || j.result === undefined)) {
          throw new Error('result null (endpoint lacks full history)');
        }
        return j.result;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 600 * (i + 1)));
      }
    }
  }
  throw new Error(`${chain} ${method} failed via all endpoints: ${lastErr?.message}`);
}

function topicToAddr(t) {
  return '0x' + t.slice(26).toLowerCase();
}

async function main() {
  const results = [];
  for (const inc of INCIDENTS) {
    const entry = { id: inc.id, chain: inc.chain, txs: [] };
    let attackerSet = new Set(inc.attacker.map((a) => a.toLowerCase()));
    let firstBlock = Infinity, lastBlock = -1;

    for (const tx of inc.txs) {
      const t = { hash: tx.hash, note: tx.note };
      try {
        const receipt = await rpc(inc.chain, 'eth_getTransactionReceipt', [tx.hash], 3, true);
        t.status = receipt.status === '0x1' ? 'success' : 'fail';
        t.block = parseInt(receipt.blockNumber, 16);
        t.contract_address = receipt.contractAddress || null;
        const blk = await rpc(inc.chain, 'eth_getBlockByNumber', ['0x' + t.block.toString(16), false]);
        t.block_ts = parseInt(blk.timestamp, 16);
        t.to = receipt.to;
        firstBlock = Math.min(firstBlock, t.block);
        lastBlock = Math.max(lastBlock, t.block);
        // 资金可能进 tx.to 合约或本次部署的合约 → 按配置纳入"相关地址"集合
        if (inc.include_to !== false && receipt.to) attackerSet.add(receipt.to.toLowerCase());
        if (receipt.contractAddress) attackerSet.add(receipt.contractAddress.toLowerCase());

        const flows = new Map(); // token -> (addr -> net raw delta)
        const counterparties = new Set();
        for (const log of receipt.logs) {
          if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
          const token = log.address.toLowerCase();
          const from = topicToAddr(log.topics[1]);
          const to = topicToAddr(log.topics[2]);
          if (attackerSet.size) {
            if (!attackerSet.has(from) && !attackerSet.has(to)) continue;
          }
          const raw = BigInt(log.data === '0x' || !log.data ? '0' : log.data);
          counterparties.add(from); counterparties.add(to);
          if (!flows.has(token)) flows.set(token, new Map());
          const perAddr = flows.get(token);
          perAddr.set(from, (perAddr.get(from) ?? 0n) - raw);
          perAddr.set(to, (perAddr.get(to) ?? 0n) + raw);
        }
        t.erc20_flows = {};
        for (const [token, perAddr] of flows) {
          t.erc20_flows[token] = Object.fromEntries([...perAddr.entries()].map(([a, v]) => [a, v.toString()]));
        }
        t.counterparties = [...counterparties];
        entry.txs.push(t);
      } catch (e) {
        t.error = e.message;
        entry.txs.push(t);
      }
    }

    // 从 receipt 推导 attacker（uwu 未记录地址）：取净流入最大的外部地址
    if (attackerSet.size === 0) {
      const net = new Map();
      for (const t of entry.txs) {
        if (!t.erc20_flows) continue;
        for (const [token, perAddr] of Object.entries(t.erc20_flows)) {
          for (const [addr, v] of Object.entries(perAddr)) {
            if (addr === t.to) continue; // 排除协议合约自身
            net.set(addr, (net.get(addr) ?? 0n) + (v.startsWith('-') ? 0n : BigInt(v)));
          }
        }
      }
      const top = [...net.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1)).slice(0, 3);
      entry.attacker_candidates = top.map(([addr, v]) => ({ addr, gross_inflow_raw: v.toString() }));
      if (top.length) attackerSet = new Set([top[0][0]]);
    }
    entry.attacker_effective = [...attackerSet];

    // 原生 ETH/BNB 余额差分（窗口前 1 块 → 最后攻击块）；限速端点多退避
    if (attackerSet.size && Number.isFinite(firstBlock)) {
      entry.native_balance_diff = {};
      for (const addr of attackerSet) {
        try {
          const b0 = BigInt(await rpc(inc.chain, 'eth_getBalance', [addr, '0x' + (firstBlock - 1).toString(16)], 5).catch(() => rpc(inc.chain, 'eth_getBalance', [addr, '0x' + (firstBlock - 1).toString(16)], 5)));
          await new Promise((r) => setTimeout(r, 1200));
          const b1 = BigInt(await rpc(inc.chain, 'eth_getBalance', [addr, '0x' + lastBlock.toString(16)], 5).catch(() => rpc(inc.chain, 'eth_getBalance', [addr, '0x' + lastBlock.toString(16)], 5)));
          entry.native_balance_diff[addr] = { before_wei: b0.toString(), after_wei: b1.toString(), delta_wei: (b1 - b0).toString(), window: [firstBlock - 1, lastBlock] };
        } catch (e) {
          entry.native_balance_diff[addr] = { error: e.message };
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    results.push(entry);
    console.error(`done: ${inc.id}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
  console.log(`written: ${OUT} (${results.length} incidents)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
