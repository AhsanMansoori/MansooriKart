import * as React from 'react';
import { PackageCheck, RefreshCw, Search, Truck } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner } from '../../components/ui';
import {
  cancelOrder,
  getOrder,
  listDropshipFulfillments,
  listOrders,
  updateDropshipFulfillment,
  updateOrderStatus,
  updatePaymentStatus,
  type AdminOrder,
  type AdminOrderDetail,
  type DropshipFulfillment,
} from '../../services/admin/orders';

function msg(error: any) {
  return error?.normalizedMessage || error?.response?.data?.error?.message || error?.message || 'Something went wrong.';
}
function money(value: number | undefined, currency = 'PKR') {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value ?? 0);
}
function customerLabel(order: AdminOrder) {
  const customer = order.customer;
  if (!customer || typeof customer === 'string') return customer || 'Guest/unknown';
  return customer.name || customer.email || 'Customer';
}

export default function OrdersPage() {
  const [tab, setTab] = React.useState<'orders' | 'fulfillments'>('orders');
  const [orders, setOrders] = React.useState<AdminOrder[]>([]);
  const [fulfillments, setFulfillments] = React.useState<DropshipFulfillment[]>([]);
  const [orderStatus, setOrderStatus] = React.useState('');
  const [fulfillmentStatus, setFulfillmentStatus] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [selectedOrder, setSelectedOrder] = React.useState<AdminOrderDetail | null>(null);
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  const loadOrders = React.useCallback(async () => {
    setBusy('load'); setError('');
    try {
      const result = await listOrders({
        limit: 50,
        ...(orderStatus ? { orderStatus } : {}),
        ...(search ? { orderNumber: search.trim() } : {}),
      });
      setOrders(result.items);
    } catch (err) { setError(msg(err)); }
    finally { setBusy(''); }
  }, [orderStatus, search]);

  const loadFulfillments = React.useCallback(async () => {
    setBusy('load'); setError('');
    try {
      const result = await listDropshipFulfillments({
        limit: 50,
        ...(fulfillmentStatus ? { status: fulfillmentStatus } : {}),
        ...(search ? { orderNumber: search.trim() } : {}),
      });
      setFulfillments(result.items);
    } catch (err) { setError(msg(err)); }
    finally { setBusy(''); }
  }, [fulfillmentStatus, search]);

  React.useEffect(() => {
    if (tab === 'orders') void loadOrders();
    else void loadFulfillments();
  }, [tab, loadOrders, loadFulfillments]);

  const openOrder = async (id: string) => {
    setBusy(id); setError('');
    try { setSelectedOrder(await getOrder(id)); }
    catch (err) { setError(msg(err)); }
    finally { setBusy(''); }
  };

  const changeOrderStatus = async (order: AdminOrder, next: AdminOrder['orderStatus']) => {
    setBusy(order._id); setError(''); setNotice('');
    try {
      await updateOrderStatus(order._id, next, 'Super Admin status update');
      setNotice(`Order ${order.orderNumber} moved to ${next}.`);
      await loadOrders();
      if (selectedOrder?._id === order._id) setSelectedOrder(await getOrder(order._id));
    } catch (err) { setError(msg(err)); }
    finally { setBusy(''); }
  };

  const changePayment = async (order: AdminOrder, next: AdminOrder['paymentStatus']) => {
    setBusy(order._id); setError(''); setNotice('');
    try {
      await updatePaymentStatus(order._id, next, 'Super Admin payment update');
      setNotice(`Payment status for ${order.orderNumber} updated to ${next}.`);
      await loadOrders();
    } catch (err) { setError(msg(err)); }
    finally { setBusy(''); }
  };

  const cancel = async (order: AdminOrder) => {
    setBusy(order._id); setError(''); setNotice('');
    try {
      await cancelOrder(order._id);
      setNotice(`Order ${order.orderNumber} cancelled.`);
      await loadOrders();
    } catch (err) { setError(msg(err)); }
    finally { setBusy(''); }
  };

  const advanceFulfillment = async (item: DropshipFulfillment, next: string) => {
    setBusy(item.id); setError(''); setNotice('');
    try {
      const updated = await updateDropshipFulfillment(item.id, { status: next as DropshipFulfillment['status'], reason: 'Super Admin fulfillment update' });
      setFulfillments(current => current.map(row => row.id === item.id ? updated : row));
      setNotice(`${item.fulfillmentNumber} moved to ${next}. Customer order status was not changed.`);
    } catch (err) { setError(msg(err)); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge>J4 · Orders</Badge>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">Orders & Dropship Fulfillment</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Customer-facing order status and supplier fulfillment are intentionally separate. Updating one does not silently advance the other.
          </p>
        </div>
        <Button className="bg-muted text-foreground hover:bg-border" onClick={() => tab === 'orders' ? void loadOrders() : void loadFulfillments()}>
          <RefreshCw size={16} aria-hidden="true" /><span className="ml-2">Refresh</span>
        </Button>
      </div>

      {error ? <Alert className="border-destructive/30 bg-destructive/5 text-destructive">{error}</Alert> : null}
      {notice ? <Alert className="border-success/30 bg-success/5">{notice}</Alert> : null}

      <div className="flex gap-2">
        <Button className={tab === 'orders' ? '' : 'bg-muted text-foreground hover:bg-border'} onClick={() => setTab('orders')}>Customer Orders</Button>
        <Button className={tab === 'fulfillments' ? '' : 'bg-muted text-foreground hover:bg-border'} onClick={() => setTab('fulfillments')}>Supplier Fulfillment</Button>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[200px_1fr_auto]">
          {tab === 'orders' ? (
            <Select value={orderStatus} onChange={event => setOrderStatus(event.target.value)}>
              <option value="">All order statuses</option>
              {['PENDING','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED'].map(value => <option key={value}>{value}</option>)}
            </Select>
          ) : (
            <Select value={fulfillmentStatus} onChange={event => setFulfillmentStatus(event.target.value)}>
              <option value="">All fulfillment statuses</option>
              {['PENDING','SENT_TO_SUPPLIER','SUPPLIER_CONFIRMED','SHIPPED','DELIVERED','FAILED','CANCELLED'].map(value => <option key={value}>{value}</option>)}
            </Select>
          )}
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Exact order number" />
          <Button onClick={() => tab === 'orders' ? void loadOrders() : void loadFulfillments()}><Search size={16} aria-hidden="true" /><span className="ml-2">Filter</span></Button>
        </div>
      </Card>

      {busy === 'load' ? <Card className="p-8"><Spinner label="Loading orders" /></Card> : tab === 'orders' ? (
        !orders.length ? <EmptyState title="No orders found">Try another status or order number.</EmptyState> : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground"><tr>
                  <th className="px-4 py-3">Order</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Order status</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">Actions</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {orders.map(order => <tr key={order._id}>
                    <td className="px-4 py-4"><button className="font-bold text-left hover:underline" onClick={() => void openOrder(order._id)}>{order.orderNumber}</button></td>
                    <td className="px-4 py-4">{customerLabel(order)}</td>
                    <td className="px-4 py-4 font-semibold">{money(order.total, order.currency)}</td>
                    <td className="px-4 py-4">
                      <Select value={order.orderStatus} onChange={event => void changeOrderStatus(order, event.target.value as AdminOrder['orderStatus'])} disabled={busy === order._id}>
                        {['PENDING','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED'].map(value => <option key={value}>{value}</option>)}
                      </Select>
                    </td>
                    <td className="px-4 py-4">
                      <Select value={order.paymentStatus} onChange={event => void changePayment(order, event.target.value as AdminOrder['paymentStatus'])} disabled={busy === order._id}>
                        {['PENDING','UNPAID','PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED'].map(value => <option key={value}>{value}</option>)}
                      </Select>
                    </td>
                    <td className="px-4 py-4 text-xs text-muted-foreground">{order.createdAt ? new Date(order.createdAt).toLocaleString() : '—'}</td>
                    <td className="px-4 py-4">
                      <Button className="bg-muted text-foreground hover:bg-border" onClick={() => void openOrder(order._id)} disabled={busy === order._id}>Details</Button>
                      {order.orderStatus !== 'CANCELLED' && order.orderStatus !== 'DELIVERED' ? <Button className="ml-2 bg-destructive text-destructive-foreground" onClick={() => void cancel(order)} disabled={busy === order._id}>Cancel</Button> : null}
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : (
        !fulfillments.length ? <EmptyState title="No dropship fulfillments found">Fulfillment records are created from dropship order lines at checkout.</EmptyState> : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1250px] text-left text-sm">
                <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground"><tr>
                  <th className="px-4 py-3">Fulfillment</th><th className="px-4 py-3">Order</th><th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Status</th><th className="px-4 py-3">Supplier Ref</th><th className="px-4 py-3">Tracking</th><th className="px-4 py-3">Next action</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {fulfillments.map(item => <tr key={item.id}>
                    <td className="px-4 py-4"><strong>{item.fulfillmentNumber}</strong><div className="text-xs text-muted-foreground">Lines: {item.orderItems.join(', ') || '—'}</div></td>
                    <td className="px-4 py-4">{item.orderNumber || item.order}</td>
                    <td className="px-4 py-4">{item.supplier.name || item.supplier.code || item.supplier.id || '—'}</td>
                    <td className="px-4 py-4"><Badge>{item.status}</Badge></td>
                    <td className="px-4 py-4">{item.supplierOrderReference || '—'}</td>
                    <td className="px-4 py-4">{item.supplierTrackingNumber || '—'}{item.carrier ? <div className="text-xs text-muted-foreground">{item.carrier}</div> : null}</td>
                    <td className="px-4 py-4">
                      {item.allowedTransitions?.length ? (
                        <Select defaultValue="" onChange={event => { if (event.target.value) void advanceFulfillment(item, event.target.value); }} disabled={busy === item.id}>
                          <option value="">Choose transition</option>
                          {item.allowedTransitions.map(value => <option key={value} value={value}>{value}</option>)}
                        </Select>
                      ) : <span className="text-xs text-muted-foreground">No further transition</span>}
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {selectedOrder ? (
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold">{selectedOrder.orderNumber}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{customerLabel(selectedOrder)} · {money(selectedOrder.total, selectedOrder.currency)}</p>
            </div>
            <Badge>{selectedOrder.orderStatus}</Badge>
          </div>

          <div className="mt-6">
            <h3 className="flex items-center gap-2 font-bold"><Truck size={18} aria-hidden="true" /> Dropship obligations</h3>
            {!selectedOrder.dropshipFulfillments?.length ? (
              <p className="mt-2 text-sm text-muted-foreground">This order has no dropship fulfillment records.</p>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {selectedOrder.dropshipFulfillments.map(item => <div key={item.id} className="rounded-mk border border-border p-4">
                  <div className="flex items-center justify-between gap-3"><strong>{item.fulfillmentNumber}</strong><Badge>{item.status}</Badge></div>
                  <p className="mt-2 text-sm text-muted-foreground">Supplier: {item.supplier.name || item.supplier.code || item.supplier.id || '—'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Order line indexes: {item.orderItems.join(', ') || '—'}</p>
                </div>)}
              </div>
            )}
          </div>

          <Alert className="mt-6 border-info/30 bg-info/5">
            <PackageCheck size={16} className="mr-2 inline" aria-hidden="true" />
            Supplier fulfillment is an internal operational workflow. Advancing it does not automatically change the customer-facing order status.
          </Alert>
        </Card>
      ) : null}
    </div>
  );
}
