import { User } from '../models/user.js';

/**
 * Provider-neutral transactional email seam.
 *
 * No provider is selected yet, so nothing here holds credentials or a fake transport. Production
 * wiring (SMTP/API adapter) belongs to the Production Configuration & Secrets phase and only needs
 * to call `setEmailAdapter`.
 *
 * Delivery is a post-commit side effect: the order, inventory and audit records are already durable
 * before an adapter is invoked, and a delivery failure can never roll back a committed business
 * transaction.
 */

export interface OrderConfirmationContent {
  orderNumber: string;
  invoiceNumber: string;
  orderDate: Date | null;
  customerName: string | null;
  items: { name: string; sku: string | null; quantity: number; unitPrice: number; lineSubtotal: number }[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;
  shippingAddressSummary: string;
  orderReference: string;
}

export interface EmailMessage {
  to: string | null;
  subject: string;
  template: 'ORDER_CONFIRMATION';
  data: OrderConfirmationContent;
}

/**
 * Password reset delivery content.
 *
 * `resetUrl` carries a single-use reset token, so it is treated as credential material: it
 * reaches the adapter and nothing else. It is never logged, never recorded in a failure
 * entry and never returned by an API (§33).
 */
export interface PasswordResetContent {
  email: string;
  resetUrl: string;
}

export interface PasswordResetMessage {
  to: string | null;
  subject: string;
  template: 'PASSWORD_RESET';
  data: PasswordResetContent;
}

export interface EmailAdapter {
  name: string;
  send(message: EmailMessage | PasswordResetMessage): Promise<void>;
}

export interface EmailFailure {
  orderNumber: string;
  adapter: string;
  reason: string;
  at: Date;
}

/** Default adapter: records intent only. It never invents a transport or reads credentials. */
const queueOnlyAdapter: EmailAdapter = {
  name: 'queue-only',
  async send(message) {
    if (message.template === 'PASSWORD_RESET') {
      console.info('Password reset email delivery deferred: no provider configured', { template: message.template });
      return;
    }
    console.info('Order confirmation email delivery deferred: no provider configured', {
      orderNumber: message.data.orderNumber,
      itemCount: message.data.items.length,
    });
  },
};

let adapter: EmailAdapter = queueOnlyAdapter;
const failures: EmailFailure[] = [];
const inFlight = new Set<Promise<unknown>>();

export function setEmailAdapter(next: EmailAdapter): void {
  adapter = next;
}
export function resetEmailAdapter(): void {
  adapter = queueOnlyAdapter;
}
export function getEmailFailures(): readonly EmailFailure[] {
  return failures;
}
export function clearEmailFailures(): void {
  failures.length = 0;
}
/** Lets callers (and tests) await in-flight post-commit deliveries without blocking checkout. */
export async function flushEmailDeliveries(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

/**
 * Attempts password reset delivery through the configured adapter.
 *
 * Never throws: `POST /api/v1/auth/forgot-password` answers with the same generic message
 * whether or not an account exists and whether or not delivery succeeded, so a provider
 * outage must not become an account-enumeration oracle. The warning on failure names the
 * adapter only — no address, no token, no URL.
 */
export async function sendPasswordReset(content: PasswordResetContent): Promise<{ delivered: boolean }> {
  const active = adapter;
  try {
    await active.send({ to: content.email, subject: 'Reset your MansooriKart password', template: 'PASSWORD_RESET', data: content });
    return { delivered: active !== queueOnlyAdapter };
  } catch {
    console.warn('Password reset email delivery failed', { adapter: active.name });
    return { delivered: false };
  }
}

function summariseAddress(address: Record<string, unknown> | null | undefined): string {
  if (!address) return '';
  return ['addressLine1', 'addressLine2', 'city', 'stateProvince', 'postalCode', 'country']
    .map(key => address[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(', ');
}

/**
 * Builds the confirmation payload strictly from the immutable order snapshot plus the customer's
 * display identity. Deliberately excludes passwords, JWTs, reset tokens, secrets and the internal
 * user document.
 */
export function buildOrderConfirmationContent(order: Record<string, any>, customer?: { name?: string; email?: string } | null): OrderConfirmationContent {
  return {
    orderNumber: String(order['orderNumber']),
    invoiceNumber: String(order['invoiceNumber'] || `INV-${order['orderNumber']}`),
    orderDate: (order['createdAt'] as Date) ?? null,
    customerName: customer?.name ?? null,
    items: (order['items'] ?? []).map((item: Record<string, any>) => ({
      name: String(item['name'] ?? ''),
      sku: typeof item['sku'] === 'string' ? item['sku'] : null,
      quantity: Number(item['quantity'] ?? 0),
      unitPrice: Number(item['unitPrice'] ?? 0),
      lineSubtotal: Number(item['lineSubtotal'] ?? 0),
    })),
    subtotal: Number(order['subtotal'] ?? 0),
    discount: Number(order['discount'] ?? 0),
    shipping: Number(order['shipping'] ?? 0),
    tax: Number(order['tax'] ?? 0),
    total: Number(order['total'] ?? 0),
    currency: String(order['currency'] ?? 'PKR'),
    paymentMethod: String(order['paymentMethod'] ?? ''),
    paymentStatus: String(order['paymentStatus'] ?? ''),
    shippingAddressSummary: summariseAddress(order['shippingAddress']),
    orderReference: String(order['_id'] ?? ''),
  };
}

/**
 * Attempts post-commit delivery. Never throws and never rethrows: a provider outage is recorded as a
 * safe failure (message text only, no credentials) and the committed order stays successful.
 */
export async function sendOrderConfirmation(order: Record<string, any>): Promise<{ delivered: boolean }> {
  const active = adapter;
  const task = (async () => {
    try {
      const customer = (await User.findById(order['customer']).select('name email').lean()) as { name?: string; email?: string } | null;
      const content = buildOrderConfirmationContent(order, customer);
      await active.send({
        to: customer?.email ?? null,
        subject: `Your ${content.invoiceNumber} order confirmation`,
        template: 'ORDER_CONFIRMATION',
        data: content,
      });
      return { delivered: active !== queueOnlyAdapter };
    } catch {
      failures.push({
        orderNumber: String(order['orderNumber'] ?? ''),
        adapter: active.name,
        reason: 'Provider delivery failed.',
        at: new Date(),
      });
      if (failures.length > 50) failures.splice(0, failures.length - 50);
      console.warn('Order confirmation email delivery failed', { orderNumber: order['orderNumber'], adapter: active.name });
      return { delivered: false };
    }
  })();
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
  return task;
}
