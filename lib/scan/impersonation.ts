import type { Finding } from './types';
import { BLUE_CHIPS } from '../solana/known';

/** Latin lookalikes from Cyrillic and Greek, the alphabets scammers use most. */
const CONFUSABLES: Record<string, string> = {
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', І: 'I', Ј: 'J', К: 'K', М: 'M', О: 'O', Р: 'P', Ѕ: 'S', Т: 'T', Х: 'X', У: 'Y', Ү: 'Y',
  а: 'a', с: 'c', е: 'e', о: 'o', р: 'p', х: 'x', у: 'y', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ԛ: 'q', ԝ: 'w',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  ο: 'o', ν: 'v', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ι: 'i', κ: 'k',
};

const INVISIBLE_ONE = /[​-‏‪-‮⁠-⁤﻿]/;
const INVISIBLE_ALL = new RegExp(INVISIBLE_ONE.source, 'g');

/** Fold a display string to the ASCII form a human would read it as. */
export function fold(s: string): { folded: string; hadConfusables: boolean; hadInvisible: boolean } {
  const hadInvisible = INVISIBLE_ONE.test(s);
  let out = s.replace(INVISIBLE_ALL, '').normalize('NFKC');
  let hadConfusables = false;
  out = [...out]
    .map((ch) => {
      const m = CONFUSABLES[ch];
      if (m) hadConfusables = true;
      return m ?? ch;
    })
    .join('');
  return { folded: out, hadConfusables, hadInvisible };
}

const canon = (s: string) => s.replace(/^\$/, '').replace(/[\s._-]/g, '').toUpperCase();

export function impersonationFindings(mint: string, name: string | null, symbol: string | null): Finding[] {
  const findings: Finding[] = [];
  const sym = symbol ? fold(symbol) : null;
  const nm = name ? fold(name) : null;

  if (sym?.hadConfusables || nm?.hadConfusables || sym?.hadInvisible || nm?.hadInvisible) {
    findings.push({
      id: 'HOMOGLYPHS',
      severity: 'high',
      category: 'impersonation',
      title: 'Name or ticker uses lookalike characters',
      detail: `Characters from other alphabets or invisible characters make this read as "${(sym?.folded ?? '') || (nm?.folded ?? '')}". The only reason to do that is to pass as something it is not.`,
      weight: 30,
      evidence: [
        { label: 'Symbol (raw)', value: JSON.stringify(symbol ?? '') },
        { label: 'Reads as', value: sym?.folded ?? nm?.folded ?? '' },
      ],
    });
  }

  const symKey = sym ? canon(sym.folded) : '';
  const bySymbol = symKey ? BLUE_CHIPS[symKey] : undefined;
  if (bySymbol && bySymbol.mint !== mint) {
    findings.push({
      id: 'IMPERSONATES_BLUECHIP',
      severity: 'critical',
      category: 'impersonation',
      title: `Impersonates ${symKey}: this is not the real ${bySymbol.name}`,
      detail: `The ticker matches ${symKey}, but the real ${bySymbol.name} mint is ${bySymbol.mint}. Fake copies are used in swaps, airdrops and phishing to sell worthless tokens at the real price.`,
      weight: 60,
      evidence: [{ label: `Real ${symKey} mint`, value: bySymbol.mint, href: `/token/${bySymbol.mint}` }],
    });
    return findings;
  }

  if (nm) {
    const nameKey = canon(nm.folded);
    const byName = Object.entries(BLUE_CHIPS).find(([, b]) => canon(b.name) === nameKey && b.mint !== mint);
    if (byName) {
      findings.push({
        id: 'IMPERSONATES_BLUECHIP_NAME',
        severity: 'high',
        category: 'impersonation',
        title: `Uses the name of ${byName[1].name}`,
        detail: `The real ${byName[1].name} is mint ${byName[1].mint}. A copy with the same name is a clone.`,
        weight: 35,
        evidence: [{ label: 'Real mint', value: byName[1].mint, href: `/token/${byName[1].mint}` }],
      });
    }
  }
  return findings;
}
