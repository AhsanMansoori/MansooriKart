import { NavLink, Outlet } from 'react-router-dom';
import { Boxes, FileSpreadsheet, LayoutDashboard, LogOut, PackageSearch, ShoppingCart, Tags, Users } from 'lucide-react';
import { cn } from '../ui';
import { clearAccessToken } from '../../services/authSession';

const navigation = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/imports', label: 'Catalog Imports', icon: FileSpreadsheet },
  { to: '/admin/products', label: 'Products', icon: PackageSearch },
  { to: '/admin/pricing', label: 'Pricing', icon: Tags },
  { to: '/admin/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/admin/suppliers', label: 'Suppliers', icon: Boxes },
  { to: '/admin/customers', label: 'Customers', icon: Users },
];

export function AdminLayout() {
  const logout = () => {
    clearAccessToken();
    window.location.assign('/login');
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-border bg-card lg:border-b-0 lg:border-r">
          <div className="flex h-16 items-center border-b border-border px-5">
            <div>
              <p className="text-lg font-extrabold tracking-tight">MansooriKart</p>
              <p className="text-xs font-medium text-muted-foreground">Super Admin</p>
            </div>
          </div>
          <nav className="grid gap-1 p-3" aria-label="Admin navigation">
            {navigation.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-mk px-3 py-2.5 text-sm font-semibold transition',
                    isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )
                }
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6">
            <div>
              <p className="text-sm font-semibold">Operations workspace</p>
              <p className="text-xs text-muted-foreground">Dropship-first administration</p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-2 rounded-mk px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut size={17} aria-hidden="true" />
              Sign out
            </button>
          </header>
          <main className="p-4 sm:p-6 lg:p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
