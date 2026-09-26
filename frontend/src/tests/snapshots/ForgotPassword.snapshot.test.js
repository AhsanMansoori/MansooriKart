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

import ForgotPassword from '../../pages/ForgotPassword';

describe('ForgotPassword reset-link contract', () => {
  it('collects an email and offers reset instructions', () => {
    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <ForgotPassword />
      </MemoryRouter>
    );
    expect(screen.getByLabelText(/email/i, { selector: 'input' })).toHaveAttribute('type', 'email');
    expect(screen.getByRole('button', { name: /send reset instructions/i })).toBeInTheDocument();
  });
});
