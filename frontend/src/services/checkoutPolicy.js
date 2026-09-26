export const paymentMethods = { COD: 'COD', ONLINE: 'ONLINE' };
export function canSubmitCheckout(method) {
  return method === paymentMethods.COD;
}
export function onlinePaymentMessage(method) {
  return method === paymentMethods.ONLINE ? 'Online payment is not available yet.' : null;
}
