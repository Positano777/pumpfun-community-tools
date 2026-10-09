import { getEnv } from '@/lib/env';
import { tokenReport } from '@/lib/service';
import { deliverAlerts, pollTelegram } from '@/lib/billing/alerts';
import { pruneUsage } from '@/lib/account';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/watch (x-cron-key): the Watchtower. Re-scans the least
 * recently checked watched tokens and turns material changes into alerts:
 * grade worsened, liquidity collapsed, deployer sold. Alerts go to the
 * token page for everyone and to Telegram and webhooks for subscribed
 * paid wallets. The same run links new Telegram chats and prunes quota
 * counters.
 */
export async function POST(req: Request) {
  const { env, ctx } = await getEnv();
  if (!env.CRON_SECRET || req.headers.get('x-cron-key') !== env.CRON_SECRET) return json({ error: 'Forbidden' }, { status: 403 });
  if (!env.DB) return json({ error: 'No database' }, { status: 503 });
  const [telegramLinked] = await Promise.all([pollTelegram(env), pruneUsage(env.DB).catch(() => undefined)]);
  const { results } = await env.DB.prepare(`SELECT * FROM watchlist ORDER BY last_checked ASC LIMIT 12`).bind().all<{
    address: string; label: string | null; last_risk: number | null; last_grade: string | null; last_liquidity: number | null;
  }>();
  const order = ['LOW', 'ELEVATED', 'HIGH', 'CRITICAL'];
  let alerts = 0;
  let delivered = 0;
  for (const w of results) {
    try {
      const r = await tokenReport(env, ctx, w.address, true);
      const msgs: { severity: string; message: string }[] = [];
      if (w.last_grade && order.indexOf(r.risk.grade) > order.indexOf(w.last_grade)) {
        msgs.push({ severity: 'high', message: `Risk worsened from ${w.last_grade} to ${r.risk.grade} (${r.risk.score}/100).` });
      }
      const liq = r.market?.totalLiquidityUsd ?? null;
      if (w.last_liquidity && liq !== null && liq < w.last_liquidity * 0.5) {
        msgs.push({ severity: 'critical', message: `Liquidity fell ${Math.round((1 - liq / w.last_liquidity) * 100)}% to $${Math.round(liq).toLocaleString('en-US')}.` });
      }
      const stmts = msgs.map((m) =>
        env.DB!.prepare(`INSERT INTO alerts (address, kind, severity, message, created_at) VALUES (?1, 'token', ?2, ?3, ?4)`).bind(w.address, m.severity, m.message, Date.now()),
      );
      stmts.push(
        env.DB!.prepare(`UPDATE watchlist SET last_risk = ?2, last_grade = ?3, last_liquidity = ?4, last_checked = ?5 WHERE address = ?1`).bind(w.address, r.risk.score, r.risk.grade, liq, Date.now()),
      );
      await env.DB.batch(stmts);
      alerts += msgs.length;
      if (msgs.length) delivered += await deliverAlerts(env, w.address, w.label ?? r.token.symbol ?? null, msgs);
    } catch (e) {
      console.warn('[watchtower] scan failed', w.address, e instanceof Error ? e.message : e);
    }
  }
  return json({ checked: results.length, alerts, delivered, telegramLinked });
}
