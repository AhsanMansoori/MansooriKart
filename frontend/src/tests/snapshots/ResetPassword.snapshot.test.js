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

import ResetPassword from '../../pages/ResetPassword';

describe('ResetPassword reset-link contract', () => {
  it('collects only the new password fields', () => {
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <ResetPassword />
      </MemoryRouter>
    );
    expect(screen.getAllByLabelText(/new password/i, { selector: 'input' })).toHaveLength(2);
    expect(screen.queryByLabelText(/^email$/i, { selector: 'input' })).not.toBeInTheDocument();
  });
});
