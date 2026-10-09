import { getEnv } from '@/lib/env';
import { verifyStripeSignature } from '@/lib/billing/stripe';
import { applyStripeEvent, parseEvent } from '@/lib/billing/webhook';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/billing/webhook: Stripe events, verified with the endpoint's signing secret. */
export async function POST(req: Request) {
  const { env } = await getEnv();
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Webhook secret not configured' }, { status: 503 });
  const payload = await req.text();
  if (!(await verifyStripeSignature(payload, req.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: 'Bad signature' }, { status: 400 });
  }
  let event;
  try {
    event = parseEvent(JSON.parse(payload));
  } catch {
    event = null;
  }
  if (!event) return json({ error: 'Malformed event' }, { status: 400 });
  try {
    const result = await applyStripeEvent(env, event);
    return json({ received: true, result });
  } catch (e) {
    // A 500 makes Stripe retry, which is what we want for a transient D1 failure.
    console.error('[billing] webhook failed', event.type, e instanceof Error ? e.message : e);
    return json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
