import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/apiClient', () => ({
  apiClient: {
    get: () => new Promise(() => {}),
    post: () => new Promise(() => {}),
    put: () => new Promise(() => {}),
    delete: () => new Promise(() => {}),
  },
  withRetry: () => new Promise(() => {}),
  API_BASE_URL: 'http://test',
}));

import Checkout from '../../pages/Checkout';

describe('Checkout payment contract', () => {
  it('offers COD without collecting raw card data', () => {
    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <Checkout cartItems={[]} onOrderComplete={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByRole('radio', { name: /cash on delivery/i })).toBeChecked();
    expect(screen.getByRole('button', { name: /place cod order/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/card number|cvc|expiry/i)).not.toBeInTheDocument();
  });
});
