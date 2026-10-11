#!/usr/bin/env node
/**
 * verify-corpus.mjs — independent attestation verifier (zero dependencies, Node >= 18).
 *
 * Three checks:
 *   1. Recompute the SHA-256 of incidents.v0.yaml and compare with attestation.sha256
 *      (content unchanged since signing);
 *   2. Verify the Ed25519 signature over the canonical JSON of the unsigned statement,
 *      using the attached issuer-public.pem;
 *   3. Print attestation metadata (version / entries / verification state) for review.
 *
 * Usage: node verify-corpus.mjs   → exit 0 = signature valid and file unchanged
 *
 * Trust-root disclosure: this is a self-issued attestation. The attached
 * issuer-public.pem IS the trust root — the signature proves the artifact has not
 * changed since signing, not who the signer is. See README "Trust root" section.
 */
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalize } from './lib/canonical-json.mjs';

const DIR = new URL('.', import.meta.url).pathname;
const attestation = JSON.parse(readFileSync(DIR + 'corpus-attestation.v1.json', 'utf8'));
const artifactBytes = readFileSync(DIR + attestation.artifact);

// 1) content integrity
const actualSha256 = createHash('sha256').update(artifactBytes).digest('hex');
const contentOk = actualSha256 === attestation.sha256 && artifactBytes.length === attestation.bytes;

// 2) signature (canonical JSON over the statement with `signature` removed)
const { signature, ...unsigned } = attestation;
const publicKey = createPublicKey(readFileSync(DIR + 'issuer-public.pem', 'utf8'));
const signatureOk = verify(
  null,
  Buffer.from(canonicalize(unsigned)),
  publicKey,
  Buffer.from(signature, 'base64url')
);

console.log(`artifact:        ${attestation.artifact} (v${attestation.version})`);
console.log(`sha256:          ${actualSha256}`);
console.log(`bytes:           ${artifactBytes.length}`);
console.log(`content match:   ${contentOk ? 'OK' : 'FAIL — file changed since signing'}`);
console.log(`signature:       ${signatureOk ? 'VALID (Ed25519, issuer=' + attestation.issuer + ' keyId=' + attestation.keyId + ')' : 'INVALID'}`);
console.log(`subject:         ${attestation.subject} — ${attestation.entries} entries, ${attestation.tx_verified_entries} tx-chain-verified (${attestation.onchain_verified_pass}), amount recompute pass ${attestation.amount_recompute_pass}`);

if (!contentOk || !signatureOk) process.exit(1);
console.log('OK');
