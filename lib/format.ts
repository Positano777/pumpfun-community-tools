/** "1 wallet", "3 wallets". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** A percentage for copy: "100%", "4.5%", "0.2%", "under 0.1%", "0%". */
export function pctText(p: number): string {
  if (p <= 0) return '0%';
  if (p >= 10) return `${Math.round(p)}%`;
  if (p >= 0.1) return `${p.toFixed(1)}%`;
  return 'under 0.1%';
}
