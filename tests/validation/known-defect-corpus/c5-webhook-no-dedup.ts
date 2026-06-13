// Fixture C5: Stripe webhook handler with no applyStripeWebhookEventOnce
import { json } from '@sveltejs/kit';

export const POST = async ({ request }) => {
  const rawBody = await request.text();
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return json({ error: 'bad json' }, { status: 400 });
  }

  if (event.type === 'payment_intent.succeeded') {
    // BUG: Handles the event but does NOT call applyStripeWebhookEventOnce
    // This means replay attacks and duplicate webhook deliveries will double-process
    const order = await getOrderByPaymentIntent(event.data.object.id);
    if (order) {
      await markOrderPaid(order.id);
    }
    return json({ ok: true, processed: true });
  }

  return json({ ok: true, received: true, outcome: 'ignored' });
};
