import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

jest.mock('../../context/NotificationProvider', () => ({
  useNotifier: () => ({ notify: jest.fn() }),
  NotificationProvider: ({ children }) => children,
}));

import NavigationBar from '../../components/NavigationBar';

describe('NavigationBar branding', () => {
  it('renders navigation links and the cart count', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavigationBar cartItemCount={3} />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /mansoorikart/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view cart/i })).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: 'Shop' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
  });

  it('opens and closes the mobile menu', () => {
    render(
      <MemoryRouter>
        <NavigationBar cartItemCount={0} />
      </MemoryRouter>
    );
    const menu = screen.getByRole('button', { name: /open navigation menu/i });
    fireEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });
});
