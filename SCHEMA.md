# Oracle 事故语料库 — SCHEMA v0

字段定义（YAML，每条目一个映射）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | `{date}-{protocol-slug}`，全库唯一，永不复用 |
| `date` | date | ✓ | 事件发生日（UTC） |
| `date_precision` | `day` \| `month` | ✓ | 二手源只给到月时必须声明，禁止假装知道具体日 |
| `chain` | string | ✓ | `ethereum` / `base` / `polygon` / `arbitrum` / `solana` / `starknet` / `multi` / … |
| `protocol` | string | ✓ | 受影响协议 |
| `asset_or_feed` | string | ✓ | 被操纵/出错的 feed 或计价资产，含关键配置语义 |
| `oracle_type` | string | ✓ | oracle 架构类型（AMM 直读 / TWAP / 多源中位数 / 去中心化网络 / 链下签名 / …） |
| `root_cause_class` | enum | ✓ | 见下方分类法 |
| `loss_usd_estimate` | [lo, hi] | ✓ | **名义**损失区间（USD）。单点值写 [x, x]。未知写 [0,0] 并用其他字段说明 |
| `realized_usd_estimate` | [lo, hi] | 可选 | 攻击者**实际变现**口径（名义与实际差 1-2 个数量级时必须分列，见 bonqdao） |
| `exposure_notional` | string | 可选 | 名义敞口（非损失），如 synthetix 的 37M sETH |
| `recovered` | string | ✓ | `full` / `partial` / `none` / `unknown` / `n-a`（无攻击者场景）+ 简注 |
| `attack_cost` | string | 推荐 | **差异化字段**：攻击者移动价格花了多少（闪电贷金额/自有资金/质押成本/零）。这是与外部 hack 数据库的核心差异，也是地基块②（操纵成本）的实证锚点 |
| `mechanism_note` | string | 推荐 | 一句话机制洞察——复盘里"如果当时有人问 X 就不会发生"的那一句 |
| `description` | string | ✓ | 事实性描述，数字须有出处支撑 |
| `outcome` | string | 推荐 | 事件结果 |
| `dispute_status` | enum | ✓ | `resolved` / `resolved-legal` / `resolved-partial-recovery` / `resolved-official-postmortem` / `resolved-controversial` / `contested-ongoing` / `unresolved` / `unknown` |
| `confidence` | enum | ✓ | `tx-hash-chain-verified` / `multi-source-verified` / `single-secondary-source` / `playbook-secondary-pending-primary` |
| `onchain_evidence` | list | 链上核验后 | 每项 `{tx, block, block_date, status, verified, method, role?}`——tx 实测记录（receipt 存在 + status + 区块时间戳吻合） |
| `attacker_address` / `attacker_addresses` | string/list | 可得时 | 多源归因的攻击者地址（二手归因，非独立核验） |
| `sources` | list | ✓ | 每项 `{url, tier, accessed}`；`tier ∈ primary / secondary / secondary-academic / internal-secondary`。链上核验后补 `primary`（tx hash / 治理帖） |
| `notes` | string | 可选 | 口径警告、playbook 判定引用等 |

## 根因分类法 v0（10 类）

| 类 | 含义 | v0 条目 |
|---|---|---|
| `amm_spot_manipulation` | AMM 现货价被闪电贷/资本移动后被当价格读取 | harvest, woofi |
| `twap_window_bypass` | TWAP 平滑被窗口实现缺陷绕过 | inverse-finance |
| `oracle_submit_underpriced` | 去中心化 oracle 报价权限成本低于收益 | bonqdao |
| `median_source_capture` | 多源中位数被多数薄源同时操纵捕获 | uwu-lend |
| `share_price_inflation` | 金库份额价（pricePerShare 类）被递归放大 | cream-finance |
| `read_only_reentrancy` | 消费侧读 oracle 时撞上 AMM 只读重入窗口 | sentiment, sturdy |
| `mark_price_manipulation` | 永续 mark price 的输入市场被真实买入拉抬 | mango, hyperliquid-jelly |
| `wrapper_config_error` | 包装器/限幅器/适配器配置语义错误 | moonwell-cbeth, aave-capo-wsteth |
| `upstream_feed_error` | 上游 feed 故障/降级冗余 | synthetix-skrw, vesu-pragma |
| `offchain_key_compromise` | 链下签名密钥失窃 | resolv |

上层归并（对应地基报告原四类）：1-7 → 操纵；8 → wrapper 配错；9 → 上游故障/停更；10 → （新增类，原枚举未含）。

## 演进纪律

1. 新条目必须带 `confidence` 与 `sources`，无出处不入库。
2. playbook 级条目完成链上核验后：升 `tx-hash-chain-verified` + 补 `onchain_evidence`（tx hash + 区块时间戳实测）。
3. `tx-hash-chain-verified` 的边界：只钉 tx 存在性与日期；损失金额仍为二手口径，链上余额差分复算才是金额的链上证明。
4. 语料文件一经签名（corpus-attestation.v1.json）即冻结：任何改动必须重签并更新 attestation。
3. 累积到 15-20 案例（v0 已 15 条，达标线已触）且每条完成 primary 核验后，方可对外发布 v1。
4. 发布前沿用"代码存在 ≠ 生产可用"披露纪律；发布形态 = 签名语料（PriorSeal 内容寻址），复用 x402-quality/v0 的规范发布路径。
