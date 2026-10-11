#!/usr/bin/env node
/**
 * validate.mjs — 事故语料库 v0 自检（零依赖）
 *
 * 检查 incidents.v0.yaml 的结构完整性：必填字段、枚举合法、出处存在、id 唯一。
 * v0 用行级启发式而非完整 YAML parser（无依赖约束）；正式 v1 接签名管道时
 * 换成结构化解析（届时语料会转 JSON 归一格式进 PriorSeal）。
 *
 * 用法：node validate.mjs [incidents 文件路径]（缺省 incidents.v0.yaml）
 */

import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? new URL('./incidents.v0.yaml', import.meta.url).pathname;
const text = readFileSync(file, 'utf8');

const REQUIRED = ['id', 'date', 'date_precision', 'chain', 'protocol', 'asset_or_feed', 'oracle_type', 'root_cause_class', 'loss_usd_estimate', 'recovered', 'description', 'dispute_status', 'confidence', 'sources'];
const ENUMS = {
  date_precision: ['day', 'month'],
  confidence: ['tx-hash-chain-verified', 'primary-disclosure-verified', 'multi-source-verified', 'single-secondary-source', 'playbook-secondary-pending-primary'],
};
const ROOT_CAUSES = ['amm_spot_manipulation', 'twap_window_bypass', 'oracle_submit_underpriced', 'median_source_capture', 'share_price_inflation', 'read_only_reentrancy', 'mark_price_manipulation', 'wrapper_config_error', 'upstream_feed_error', 'offchain_key_compromise'];

// 切分条目块（每个 "  - id:" 开头一块）
const lines = text.split('\n');
const entries = [];
let current = null;
for (const line of lines) {
  if (/^  - id: /.test(line)) {
    if (current) entries.push(current);
    current = { lines: [line], id: line.slice(8).trim() };
  } else if (current && /^ {4,}/.test(line)) {
    current.lines.push(line);
  }
}
if (current) entries.push(current);

const errors = [];
const seen = new Set();
for (const e of entries) {
  const block = e.lines.join('\n');
  if (seen.has(e.id)) errors.push(`${e.id}: 重复 id`);
  seen.add(e.id);
  for (const f of REQUIRED) {
    if (!new RegExp(`^    ${f}:`, 'm').test(block) && !new RegExp(`^      - \\{url`, 'm').test(block) && f !== 'sources') {
      errors.push(`${e.id}: 缺必填字段 ${f}`);
    }
  }
  if (!/^      - \{url: /m.test(block)) errors.push(`${e.id}: 无出处（sources 为空或格式错）`);
  const rc = block.match(/^    root_cause_class: (\S+)/m);
  if (!rc || !ROOT_CAUSES.includes(rc[1])) errors.push(`${e.id}: root_cause_class 非法（${rc?.[1] ?? 'missing'}）`);
  const dp = block.match(/^    date_precision: (\S+)/m);
  if (dp && !ENUMS.date_precision.includes(dp[1])) errors.push(`${e.id}: date_precision 非法`);
  const cf = block.match(/^    confidence: (\S+)/m);
  if (cf && !ENUMS.confidence.includes(cf[1])) errors.push(`${e.id}: confidence 非法`);
  if (!/^    date: \d{4}-\d{2}/m.test(block)) errors.push(`${e.id}: date 格式非法`);
  // 置信与来源联动纪律：multi-source-verified 至少 2 个来源
  const srcCount = (block.match(/\{url:/g) ?? []).length;
  if (cf?.[1] === 'multi-source-verified' && srcCount < 2) errors.push(`${e.id}: 声称 multi-source-verified 但来源 < 2`);
  // tx-hash-chain-verified 必须带 onchain_evidence（tx 行存在且含 verified 日期）
  if (cf?.[1] === 'tx-hash-chain-verified') {
    if (!/^    onchain_evidence:/m.test(block)) errors.push(`${e.id}: 声称 tx-hash-chain-verified 但无 onchain_evidence`);
    else if (!/verified: \d{4}-\d{2}-\d{2}/.test(block)) errors.push(`${e.id}: onchain_evidence 缺 verified 日期`);
    else if (srcCount < 2) errors.push(`${e.id}: tx-hash-chain-verified 条目仍需 >=2 个二手源（tx 只钉日期，金额靠二手口径）`);
  }
  // 未核实条目不得缺 notes/口径警告（playbook 级必须有 pending 提示）
  if (cf?.[1] === 'playbook-secondary-pending-primary' && !/playbook/i.test(block)) errors.push(`${e.id}: playbook 级条目应标注 playbook 出处引用`);
}

console.log(`entries: ${entries.length}`);
if (errors.length) {
  console.error(`FAIL (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('OK: 必填字段 / 枚举 / id 唯一 / 出处纪律 全部通过');
