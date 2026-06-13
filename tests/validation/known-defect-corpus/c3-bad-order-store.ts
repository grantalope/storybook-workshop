// Fixture C3: Class implements OrderStore but missing getByLuluJob
import type { Order } from '../fulfillment/types.js';

export class BadOrderStore implements OrderStore {
  async get(id: string): Promise<Order | undefined> {
    return undefined;
  }

  async put(order: Order): Promise<void> {
    // stub
  }

  async listByParent(email: string): Promise<Order[]> {
    return [];
  }

  async getByStripePaymentIntent(id: string): Promise<Order | undefined> {
    return undefined;
  }

  // getByLuluJob is intentionally MISSING to test the probe
}
