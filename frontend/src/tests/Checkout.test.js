import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Checkout from '../pages/Checkout';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('../context/NotificationProvider', () => ({
  useNotifier: () => ({
    notify: jest.fn(),
  }),
}));

// Checkout now places the order through `services/checkout`, which owns the multi-step v1
// sequence (stage the cart, save the address, POST the checkout with one Idempotency-Key).
// Mocking that seam keeps this test about the page's own behaviour: spinner, then redirect.
const mockPrepareCodOrder = jest.fn(() =>
  Promise.resolve({
    body: { items: [{ productId: '1', quantity: 1 }] },
    quote: { quoteHash: 'a'.repeat(64), currency: 'PKR', subtotal: 100, discount: 0, shipping: 250, tax: 0, total: 350 },
  })
);
const mockConfirmCodOrder = jest.fn(() =>
  Promise.resolve({ _id: '65f000000000000000000001', orderNumber: 'MK-000123', items: [], total: 350, currency: 'PKR' })
);
jest.mock('../services/checkout', () => ({
  prepareCodOrder: (...args) => mockPrepareCodOrder(...args),
  confirmCodOrder: (...args) => mockConfirmCodOrder(...args),
  toAddressPayload: form => form,
}));

jest.mock('../services/lastOrder', () => ({
  rememberLastOrder: jest.fn(),
}));

// Mock the CheckoutForm to simply render a button that calls onSubmit when clicked
jest.mock('../components/CheckoutForm', () => props => <button onClick={() => props.onSubmit({ email: 'test@example.com' })}>Submit Order</button>);

describe('<Checkout />', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockPrepareCodOrder.mockClear();
    mockConfirmCodOrder.mockClear();
  });

  it('renders the form initially', () => {
    render(<Checkout cartItems={[]} />);
    expect(screen.getByRole('button', { name: /submit order/i })).toBeInTheDocument();
  });

  it('shows loading spinner, then navigates to success', async () => {
    render(<Checkout cartItems={[{ id: '1', _id: '1', name: 'Test Product', price: 100 }]} />);

    // click the mock form's submit button
    fireEvent.click(screen.getByRole('button', { name: /submit order/i }));

    // loading spinner should appear
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    const confirm = await screen.findByRole('button', { name: /confirm cod order/i });
    expect(screen.getByText(/PKR 350.00/)).toBeInTheDocument();
    fireEvent.click(confirm);

    // after explicit confirmation, navigate should have been called
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/order-success', expect.any(Object));
    });
  });
});
