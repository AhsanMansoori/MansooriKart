import { apiClient, unwrap, unwrapMeta } from '../apiClient';

export type AdminOrder = {
  _id: string;
  orderNumber: string;
  invoiceNumber?: string;
  customer?: { _id?: string; id?: string; name?: string; email?: string } | string | null;
  items?: Array<Record<string, unknown>>;
  subtotal?: number;
  discount?: number;
  shipping?: number;
  tax?: number;
  total: number;
  currency?: string;
  paymentMethod?: string;
  paymentStatus: 'PENDING' | 'UNPAID' | 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  orderStatus: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  createdAt?: string;
  updatedAt?: string;
};

export type DropshipFulfillment = {
  id: string;
  fulfillmentNumber: string;
  order: string;
  orderNumber?: string | null;
  orderItems: number[];
  supplier: { id: string | null; name: string | null; code: string | null; email: string | null; phone: string | null };
  status: 'PENDING' | 'SENT_TO_SUPPLIER' | 'SUPPLIER_CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
  supplierOrderReference?: string | null;
  supplierTrackingNumber?: string | null;
  carrier?: string | null;
  trackingUrl?: string | null;
  timeline: Record<string, string | null>;
  notes?: string | null;
  allowedTransitions: string[];
  cancellationPolicy?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminOrderDetail = AdminOrder & {
  dropshipFulfillments?: DropshipFulfillment[];
};

export async function listOrders(params: {
  page?: number;
  limit?: number;
  orderStatus?: string;
  paymentStatus?: string;
  customer?: string;
  orderNumber?: string;
} = {}) {
  const response = await apiClient.get('/admin/orders', { params: { page: 1, limit: 20, ...params } });
  return { items: unwrap(response) as AdminOrder[], meta: unwrapMeta(response) };
}

export async function getOrder(orderId: string) {
  const response = await apiClient.get(`/admin/orders/${orderId}`);
  return unwrap(response) as AdminOrderDetail;
}

export async function updateOrderStatus(orderId: string, status: AdminOrder['orderStatus'], reason?: string) {
  const response = await apiClient.patch(`/admin/orders/${orderId}/status`, { status, ...(reason ? { reason } : {}) });
  return unwrap(response) as AdminOrder;
}

export async function updatePaymentStatus(orderId: string, paymentStatus: AdminOrder['paymentStatus'], reason?: string) {
  const response = await apiClient.patch(`/admin/orders/${orderId}/payment-status`, { paymentStatus, ...(reason ? { reason } : {}) });
  return unwrap(response) as AdminOrder;
}

export async function cancelOrder(orderId: string) {
  const response = await apiClient.post(`/admin/orders/${orderId}/cancel`, {});
  return unwrap(response) as AdminOrder;
}

export async function listDropshipFulfillments(params: {
  page?: number;
  limit?: number;
  status?: string;
  orderNumber?: string;
} = {}) {
  const response = await apiClient.get('/admin/dropship-fulfillments', { params: { page: 1, limit: 20, ...params } });
  return { items: unwrap(response) as DropshipFulfillment[], meta: unwrapMeta(response) };
}

export async function updateDropshipFulfillment(
  id: string,
  body: Partial<Pick<DropshipFulfillment, 'status' | 'supplierOrderReference' | 'supplierTrackingNumber' | 'carrier' | 'trackingUrl' | 'notes'>> & { reason?: string }
) {
  const response = await apiClient.patch(`/admin/dropship-fulfillments/${id}`, body);
  return unwrap(response) as DropshipFulfillment;
}
