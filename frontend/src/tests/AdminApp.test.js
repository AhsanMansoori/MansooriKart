import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminApp from '../components/AdminApp';
import { adminApi } from '../services/adminApi';

jest.mock('../services/adminApi', () => ({
  adminApi: {
    dashboard: jest.fn(),
    dashboardSales: jest.fn(),
    list: jest.fn(),
  },
  adminResources: {},
}));

const token = role => `header.${window.btoa(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;

describe('Super Admin ERP shell', () => {
  beforeEach(() => {
    localStorage.clear();
    adminApi.dashboard.mockResolvedValue({
      data: { totalRevenue: 2500, totalOrders: 3, totalProducts: 8, totalCustomers: 4, lowStockProducts: 1, lowStockItems: [], recentOrders: [] },
    });
    adminApi.dashboardSales.mockResolvedValue({ data: [{ date: '2026-09-08', revenue: 2500, orders: 3 }] });
  });

  it('redirects unauthenticated users to login', () => {
    render(
      <MemoryRouter initialEntries={['/admin/dashboard']}>
        <AdminApp />
      </MemoryRouter>
    );
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByText('Good morning, Super Admin')).not.toBeInTheDocument();
  });

  it('redirects customer tokens away from admin', () => {
    localStorage.setItem('mansoorikart_access_token', token('CUSTOMER'));
    render(
      <MemoryRouter initialEntries={['/admin/dashboard']}>
        <AdminApp />
      </MemoryRouter>
    );
    expect(screen.queryByText('Good morning, Super Admin')).not.toBeInTheDocument();
  });

  it('renders the live dashboard for a Super Admin', async () => {
    localStorage.setItem('mansoorikart_access_token', token('SUPER_ADMIN'));
    render(
      <MemoryRouter initialEntries={['/admin/dashboard']}>
        <AdminApp />
      </MemoryRouter>
    );
    expect(screen.getByRole('navigation', { name: /super admin navigation/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('PKR 2,500')).toBeInTheDocument());
    expect(adminApi.dashboard).toHaveBeenCalledTimes(1);
    expect(adminApi.dashboardSales).toHaveBeenCalledWith('30d');
  });
});
