import type { ExtensionInfo, Finding } from './types';
import { REGULATED_ISSUER_MINTS, programLabel } from '../solana/known';
import { isPda, shortAddress } from '../solana/address';

export interface ParsedMint {
  program: 'spl-token' | 'spl-token-2022';
  decimals: number;
  supply: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: { extension: string; state?: Record<string, unknown> }[];
}

export interface MintAnalysis {
  extensions: ExtensionInfo[];
  findings: Finding[];
  /** Token-2022 in-mint metadata, when present. */
  tokenMetadata: { name: string; symbol: string; uri: string; updateAuthority: string | null } | null;
  transferFeeBps: number;
  permanentDelegate: string | null;
}

const ev = (label: string, value: string | null | undefined) => ({ label, value: value ?? 'none' });

/**
 * Authority and Token-2022 extension audit. This is the part of the report
 * that is pure fact: each finding maps to a capability the issuer holds today.
 */
export function analyzeMint(mint: string, m: ParsedMint): MintAnalysis {
  const findings: Finding[] = [];
  const extensions: ExtensionInfo[] = [];
  const regulated = REGULATED_ISSUER_MINTS.has(mint);
  const regulatedNote = ' Expected for a regulated stablecoin issuer, which must be able to comply with legal orders.';

  // --- Mint authority ---------------------------------------------------
  if (m.mintAuthority) {
    findings.push({
      id: 'MINT_AUTHORITY_ACTIVE',
      severity: regulated ? 'info' : 'high',
      category: 'authority',
      title: 'Mint authority is live',
      detail:
        'The holder of this key can print unlimited new supply at any moment, diluting every holder to zero.' +
        (regulated ? regulatedNote : ''),
      weight: regulated ? 0 : 30,
      evidence: [ev('Mint authority', m.mintAuthority), ev('Authority type', authorityKind(m.mintAuthority))],
    });
  } else {
    findings.push({
      id: 'MINT_AUTHORITY_REVOKED',
      severity: 'good',
      category: 'authority',
      title: 'Mint authority revoked',
      detail: 'Supply is fixed forever. Nobody can mint more tokens.',
      weight: 0,
    });
  }

  // --- Freeze authority -------------------------------------------------
  if (m.freezeAuthority) {
    findings.push({
      id: 'FREEZE_AUTHORITY_ACTIVE',
      severity: regulated ? 'info' : 'high',
      category: 'authority',
      title: 'Freeze authority is live',
      detail:
        'The issuer can freeze any holder\'s token account so it can never sell. This is the classic Solana honeypot switch.' +
        (regulated ? regulatedNote : ''),
      weight: regulated ? 0 : 25,
      evidence: [ev('Freeze authority', m.freezeAuthority), ev('Authority type', authorityKind(m.freezeAuthority))],
    });
  } else {
    findings.push({
      id: 'FREEZE_AUTHORITY_REVOKED',
      severity: 'good',
      category: 'authority',
      title: 'Freeze authority revoked',
      detail: 'No one can freeze holder accounts.',
      weight: 0,
    });
  }

  // --- Token-2022 extensions --------------------------------------------
  let tokenMetadata: MintAnalysis['tokenMetadata'] = null;
  let transferFeeBps = 0;
  let permanentDelegate: string | null = null;

  for (const { extension, state = {} } of m.extensions) {
    const s = state as Record<string, any>;
    switch (extension) {
      case 'permanentDelegate': {
        permanentDelegate = (s.delegate as string) ?? null;
        if (!permanentDelegate) break;
        extensions.push({ name: 'Permanent delegate', severity: regulated ? 'info' : 'critical', detail: `${shortAddress(permanentDelegate)} can move or burn tokens from any wallet.` });
        findings.push({
          id: 'PERMANENT_DELEGATE',
          severity: regulated ? 'info' : 'critical',
          category: 'extension',
          title: 'Permanent delegate can seize tokens from any holder',
          detail:
            'A Token-2022 permanent delegate can transfer or burn tokens out of every holder\'s wallet without their signature. Buyers do not own what they hold.' +
            (regulated ? regulatedNote : ''),
          weight: regulated ? 0 : 60,
          evidence: [ev('Permanent delegate', permanentDelegate)],
        });
        break;
      }
      case 'transferHook': {
        const hook = s.programId as string | null;
        extensions.push({ name: 'Transfer hook', severity: hook ? 'high' : 'low', detail: hook ? `Every transfer calls program ${shortAddress(hook)}.` : 'Configured but no hook program is set.' });
        if (hook) {
          findings.push({
            id: 'TRANSFER_HOOK',
            severity: 'high',
            category: 'extension',
            title: 'Transfer hook runs custom code on every transfer',
            detail: 'A hook program can reject sells, tax them, or whitelist who may trade. It is the most flexible honeypot primitive on Solana.',
            weight: 30,
            evidence: [ev('Hook program', hook), ev('Hook authority', s.authority as string)],
          });
        } else if (s.authority) {
          findings.push({
            id: 'TRANSFER_HOOK_DORMANT',
            severity: regulated ? 'info' : 'low',
            category: 'extension',
            title: 'Dormant transfer hook can be switched on',
            detail: 'No hook program is set today, but its authority can install one later and gate every transfer.',
            weight: regulated ? 0 : 6,
            evidence: [ev('Hook authority', s.authority as string)],
          });
        }
        break;
      }
      case 'transferFeeConfig': {
        const newer = s.newerTransferFee ?? {};
        const older = s.olderTransferFee ?? {};
        const bps = Math.max(Number(newer.transferFeeBasisPoints ?? 0), Number(older.transferFeeBasisPoints ?? 0));
        transferFeeBps = bps;
        const pct = bps / 100;
        const sev = bps >= 1000 ? 'critical' : bps >= 500 ? 'high' : bps >= 100 ? 'medium' : bps > 0 ? 'low' : 'info';
        extensions.push({ name: 'Transfer fee', severity: sev, detail: `${pct}% on every transfer${s.transferFeeConfigAuthority ? ', adjustable by the issuer' : ''}.` });
        if (bps > 0) {
          findings.push({
            id: 'TRANSFER_FEE',
            severity: sev,
            category: 'extension',
            title: `${pct}% tax on every transfer`,
            detail: `Each buy, sell and wallet transfer withholds ${pct}% for ${shortAddress(s.withdrawWithheldAuthority as string)}. Launchpad royalties are usually 1 to 3%; anything above 5% bleeds holders.`,
            weight: bps >= 1000 ? 60 : bps >= 500 ? 30 : bps >= 100 ? 10 : 4,
            evidence: [ev('Fee (bps)', String(bps)), ev('Fee harvester', s.withdrawWithheldAuthority as string), ev('Fee config authority', s.transferFeeConfigAuthority as string)],
          });
        }
        if (s.transferFeeConfigAuthority && !regulated) {
          findings.push({
            id: 'TRANSFER_FEE_MUTABLE',
            severity: 'medium',
            category: 'extension',
            title: 'Transfer fee can be raised later',
            detail: 'The fee config authority can change the tax (up to 100%) with a one-epoch delay. A 0% tax today is not a promise.',
            weight: 12,
            evidence: [ev('Fee config authority', s.transferFeeConfigAuthority as string)],
          });
        }
        break;
      }
      case 'defaultAccountState': {
        const frozen = String(s.accountState ?? '').toLowerCase() === 'frozen';
        extensions.push({ name: 'Default account state', severity: frozen ? 'high' : 'info', detail: frozen ? 'New holder accounts start frozen.' : `New accounts start ${s.accountState}.` });
        if (frozen) {
          findings.push({
            id: 'DEFAULT_FROZEN',
            severity: regulated ? 'info' : 'high',
            category: 'extension',
            title: 'New holders start frozen',
            detail: 'Every new token account is created frozen; only the freeze authority can unlock it. Unless you are whitelisted, you can buy but not sell.',
            weight: regulated ? 0 : 35,
          });
        }
        break;
      }
      case 'nonTransferable': {
        extensions.push({ name: 'Non-transferable', severity: 'critical', detail: 'Tokens cannot be moved after minting.' });
        findings.push({
          id: 'NON_TRANSFERABLE',
          severity: 'critical',
          category: 'extension',
          title: 'Soulbound: this token cannot be transferred',
          detail: 'Non-transferable tokens cannot be sold or moved. If it trades as a currency, something is misrepresented.',
          weight: 50,
        });
        break;
      }
      case 'pausableConfig': {
        const paused = Boolean(s.paused);
        extensions.push({ name: 'Pausable', severity: paused ? 'critical' : 'high', detail: paused ? 'Transfers are paused right now.' : 'The issuer can pause all transfers.' });
        findings.push({
          id: paused ? 'PAUSED' : 'PAUSABLE',
          severity: paused ? 'critical' : regulated ? 'info' : 'high',
          category: 'extension',
          title: paused ? 'All transfers are paused right now' : 'Issuer can pause every transfer',
          detail: paused ? 'Nobody can sell or move this token until the pause authority lifts it.' : 'A single key can halt all trading at any time, trapping holders.',
          weight: paused ? 70 : regulated ? 0 : 30,
          evidence: [ev('Pause authority', s.authority as string)],
        });
        break;
      }
      case 'mintCloseAuthority': {
        extensions.push({ name: 'Mint close authority', severity: 'low', detail: 'The mint account can be closed once supply is zero.' });
        break;
      }
      case 'interestBearingConfig':
      case 'scaledUiAmountConfig': {
        extensions.push({ name: extension === 'interestBearingConfig' ? 'Interest-bearing' : 'Scaled UI amount', severity: 'medium', detail: 'Wallets display a balance the issuer can rescale.' });
        findings.push({
          id: 'UI_AMOUNT_RESCALABLE',
          severity: regulated ? 'info' : 'medium',
          category: 'extension',
          title: 'Displayed balances can be rescaled by the issuer',
          detail: 'The amount your wallet shows is multiplied by an issuer-controlled rate. Screenshots of balances prove nothing.',
          weight: regulated ? 0 : 10,
        });
        break;
      }
      case 'confidentialTransferMint': {
        extensions.push({ name: 'Confidential transfers', severity: 'medium', detail: 'Balances and amounts can be encrypted.' });
        if (!regulated) {
          findings.push({
            id: 'CONFIDENTIAL_TRANSFERS',
            severity: 'low',
            category: 'extension',
            title: 'Confidential transfers enabled',
            detail: 'Encrypted amounts make insider flows harder to audit on chain.',
            weight: 5,
          });
        }
        break;
      }
      case 'tokenMetadata': {
        tokenMetadata = {
          name: String(s.name ?? '').trim(),
          symbol: String(s.symbol ?? '').trim(),
          uri: String(s.uri ?? '').trim(),
          updateAuthority: (s.updateAuthority as string) ?? null,
        };
        extensions.push({ name: 'Token metadata', severity: 'info', detail: 'Name, symbol and URI stored on the mint.' });
        break;
      }
      case 'metadataPointer':
        extensions.push({ name: 'Metadata pointer', severity: 'info', detail: `Metadata lives at ${shortAddress(s.metadataAddress as string)}.` });
        break;
      default:
        extensions.push({ name: extension, severity: 'info', detail: 'Extension present.' });
    }
  }

  return { extensions, findings, tokenMetadata, transferFeeBps, permanentDelegate };
}

function authorityKind(address: string): string {
  const label = programLabel(address);
  if (label) return label;
  return isPda(address) ? 'Program-controlled (PDA)' : 'Single keypair';
}
