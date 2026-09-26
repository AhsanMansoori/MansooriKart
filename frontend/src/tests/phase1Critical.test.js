import { getAccessToken, persistAccessToken, ACCESS_TOKEN_KEY } from '../services/authSession';
import { canSubmitCheckout, onlinePaymentMessage, paymentMethods } from '../services/checkoutPolicy';

describe('Phase 1 critical storefront policies', () => {
  beforeEach(() => localStorage.clear());
  it('migrates a legacy access token safely', () => {
    localStorage.setItem('MERNEcommerceToken', 'legacy');
    expect(getAccessToken()).toBe('legacy');
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('legacy');
    expect(localStorage.getItem('MERNEcommerceToken')).toBeNull();
  });
  it('persists only the MansooriKart auth key', () => {
    persistAccessToken('new-token');
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('new-token');
  });
  it('permits COD and safely blocks online payment', () => {
    expect(canSubmitCheckout(paymentMethods.COD)).toBe(true);
    expect(canSubmitCheckout(paymentMethods.ONLINE)).toBe(false);
    expect(onlinePaymentMessage(paymentMethods.ONLINE)).toMatch(/not available/i);
  });
});
