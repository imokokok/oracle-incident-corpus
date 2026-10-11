# 语料库 v1.0.0 金额链上复算报告（2026-10-12）

**对象**：`incidents.v0.yaml` v1.0.0（15 条目，8 条 tx-verified）
**方法**：`scripts/recompute-v1.mjs`（12 个攻击 tx 的 receipt → ERC-20 Transfer 日志按 attacker 地址聚合 + `eth_getBalance` 攻击窗口差分）→ `scripts/analyze-v1.mjs`（DefiLlama `coins/prices/historical` 按攻击块时间戳计价，无 key）。
**原始数据**：`data/recompute-raw.json`、`data/recompute-priced.json`（可独立重跑复核）。
**边界（诚实声明）**：只复算攻击 tx 内/紧后窗口的资产流出（token 级）；realized（后续变现）与追回金额仍为二手/官方口径。复算 USD 使用 DefiLlama 攻击块时点价——当被操纵的池本身就是计价池时（uwu），时点价本身失真，见 flagged 条。

## 逐条判定

| 条目 | 判定 | 复算结果 vs 记录口径 |
|---|---|---|
| 2022-04-02 inverse | **confirmed** | WBTC **94.0307**（记录 94）· DOLA **3,999,669**（~4M）· YFI **39.368**（39）· ETH **+1,586.51**（记录 1588，差 1.49≈gas）。llama 时点价合计 **≈$14.84M**，落于记录 $14.5–15.6M 区间内 |
| 2023-06-12 sturdy | **confirmed** | 攻击 EOA 原生 ETH 窗口差分 **+442.1176**（记录 442 ETH），llama 价 $773K ≈ 记录 $775K |
| 2023-02-01 bonqdao | **token-confirmed** | WALBT **+113,813,985**（记录 ~113.8M，逐位吻合）· BEUR **+98,658,539**（记录 1 亿）· TRB -20（撤质押）。llama 攻击时点 WALBT≈$0.105（名义口径 ~$1）——直接实证"名义与变现差 1–2 个数量级" |
| 2021-10-27 cream | **refined** | 借出资产逐 token 复现：2,751.06 ETH($11.0M)+USDC 1.69M+USDT 3.78M+FEI 3.82M+CRETH2 12,266($39.9M)+xSUSHI 623,761($8.0M)+wNXM 135,403($7.6M)+PERP 447,223($7.7M)+DPI 15,568($5.3M)+UNI 156,629($3.9M)+GNO 6,937($2.9M)+FTT 38,922($2.3M)+YGG 341,682($1.9M) ≈ **$110M 已计价**（+4 个低流动性 token 无价未计）。$130M 口径同量级但未被完整复现——两级数字并列 |
| 2020-10-26 harvest | **partial** | 记录 tx 内获利合约 0xc602… 净得 **+691,782 USDC + 20 WETH**（≈$0.70M）——与"每轮获利约 $500K"同量级；总利润经 32 轮/多 tx/多地址流出，超出记录范围。$24–34M 维持二手 |
| 2024-03-05 woofi | **partial** | 攻击 EOA 净得 **+887,069 WOO**（$0.51M）；8.57M WOO 在 tx 内经池子卖回，利润 USDC.e 流出至未收录新地址，单 tx 范围未捕获。~$8.75M 维持二手 |
| 2026-03-22 resolv | **partial** | 签名 EOA 0x15Ca… 两 tx 内**零直接代币净流**（全部资产经完成合约中转，日志级对 EOA 不可见）；~11,400 ETH 提款需 swap 合约→Curve→退出多跳追踪，超出本 v1 范围。$23–25M 维持二手+官方复盘 |
| 2024-06-10 uwu | **⚠️ flagged** | 受益 EOA 0xed1521…（本复算推导）在记录 tx 内净得 **+41,476,516 uSUSDE + 1,393,231 sDAI** 等，llama 时点价 ≈**$46M** —— 超出二手区间 $19.3–20.3M **2 倍以上**。冲突未仲裁（见下），**仲裁前本条金额不得外引** |
| 其余 7 条 | **none-applicable** | feed 故障/配置错误类（无攻击 tx）、Starknet/Solana/非 EVM、sentiment tx 未复现——各自维持原有核验天花板 |

## uwu 冲突的三种可能解释（仲裁清单）

1. **二手源低估**：复算值若成立，UwU 首轮损失 ≈$46M 而非 ~$20M——需把另外 2 笔攻击 tx 收录后做全窗口余额差分定案；
2. **时点价失真**：sUSDe 计价池本身就是攻击中被操纵的池，llama 在该时间戳的价可能继承操纵污染；
3. **资产身份待确认**：41.47M uSUSDe 是 UwU 的计息凭证，需人工确认其与底层 sUSDe 的兑换语义及是否在 tx2/3 中回吐。

## 顺带修复的数据缺陷（复算过程发现）

- **resolv 条目 `sources:` 键重复**：第二个 sources 块使 YAML 解析时前 4 条来源被静默覆盖——已合并为 5 条。
- **aave-capo 条目 `recovered:` 键重复**：同型 bug——已去重保留信息全的一条。
- 教训：v0 用行级启发式校验测不出重复键；v1 起结构化解析（js-yaml）纳入校验流程。

## 签名

- 新 attestation：`corpus-attestation.v1.json`，sha256 `ea8411cd82366de69f8c10e380b0b60dd91091c979871990ab1269fd8ddfd78e`（42,415 字节），Ed25519 验签通过。
- 旧 v0.3 签名（`ad15bb2d…`，36,679 字节）自本版本起作废。
