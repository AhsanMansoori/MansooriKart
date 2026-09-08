function CsvImportPage() {
  const [step, setStep] = React.useState(1);
  const [suppliers, setSuppliers] = React.useState([]);
  const [supplierId, setSupplierId] = React.useState('');
  const [file, setFile] = React.useState(null);
  const [job, setJob] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const [mapping, setMapping] = React.useState({});
  const [state, setState] = React.useState({ loading: false, error: null });
  React.useEffect(() => {
    adminApi
      .list('/suppliers', { page: 1, limit: 100 })
      .then(result => setSuppliers(Array.isArray(result.data) ? result.data : []))
      .catch(error => setState({ loading: false, error: error.normalizedMessage }));
  }, []);
  const upload = async () => {
    setState({ loading: true, error: null });
    try {
      const result = await adminApi.uploadCsv({ supplierId, fileName: file.name, file });
      setJob(result.data.job);
      setMapping(result.data.suggestedMapping || result.data.templateMapping || {});
      setStep(3);
    } catch (error) {
      setState({ loading: false, error: error.normalizedMessage });
      return;
    }
    setState({ loading: false, error: null });
  };
  const confirmMapping = async () => {
    setState({ loading: true, error: null });
    try {
      const result = await adminApi.mapImport(job.id, { mapping });
      setJob(result.data);
      const next = await adminApi.previewImport(job.id);
      setPreview(next.data);
      setStep(4);
    } catch (error) {
      setState({ loading: false, error: error.normalizedMessage });
      return;
    }
    setState({ loading: false, error: null });
  };
  const run = async () => {
    setState({ loading: true, error: null });
    try {
      const result = await adminApi.runImport(job.id);
      setJob(result.data.job);
      setStep(5);
    } catch (error) {
      setState({ loading: false, error: error.normalizedMessage });
      return;
    }
    setState({ loading: false, error: null });
  };
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">CSV-first workflow</p>
          <h1>Import supplier catalog</h1>
          <p>Upload, validate, and create DRAFT products without publishing them.</p>
        </div>
      </div>
      <section className="panel import-panel">
        <div className="import-steps">
          {['Supplier', 'Upload', 'Mapping', 'Preview', 'Results'].map((label, index) => (
            <div className={step >= index + 1 ? 'complete' : ''} key={label}>
              <span>{index + 1}</span>
              {label}
            </div>
          ))}
        </div>
        {state.error && (
          <div className="form-error" role="alert">
            {state.error}
          </div>
        )}
        {step === 1 && (
          <div className="import-form">
            <label>
              Supplier
              <select value={supplierId} onChange={event => setSupplierId(event.target.value)}>
                <option value="">Select a supplier</option>
                {suppliers.map(supplier => (
                  <option key={supplier.id || supplier._id} value={supplier.id || supplier._id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" disabled={!supplierId} onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        )}
        {step === 2 && (
          <div className="import-form">
            <label className="dropzone">
              CSV file
              <input type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0] || null)} />
              <strong>{file ? file.name : 'Choose a CSV file'}</strong>
              <small>Raw CSV is validated by the backend before catalog writes.</small>
            </label>
            <div className="form-actions">
              <button className="secondary-button" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="primary-button" disabled={!file || state.loading} onClick={upload}>
                {state.loading ? 'Uploading...' : 'Upload CSV'}
              </button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="import-form">
            <h2>Confirm column mapping</h2>
            <p className="muted-copy">The backend suggested these mappings. Review them before previewing rows.</p>
            <div className="mapping-grid">
              {Object.entries(mapping).map(([target, source]) => (
                <label key={target}>
                  {target}
                  <input value={source || ''} onChange={event => setMapping(current => ({ ...current, [target]: event.target.value }))} />
                </label>
              ))}
            </div>
            <button className="primary-button" disabled={state.loading} onClick={confirmMapping}>
              {state.loading ? 'Preparing preview...' : 'Preview rows'}
            </button>
          </div>
        )}
        {step === 4 && (
          <div className="import-form">
            <h2>Validation preview</h2>
            <div className="result-grid">
              <div>
                <span>Rows sampled</span>
                <strong>{preview?.sampledRows || 0}</strong>
              </div>
              <div>
                <span>Total rows</span>
                <strong>{preview?.totalRows || 0}</strong>
              </div>
              <div>
                <span>More rows</span>
                <strong>{preview?.hasMoreRows ? 'Yes' : 'No'}</strong>
              </div>
            </div>
            <DataTable rows={preview?.rows || []} columns={['rowNumber', 'supplierSku', 'productName', 'result']} />
            <div className="form-actions">
              <button className="secondary-button" onClick={() => setStep(3)}>
                Back
              </button>
              <button className="primary-button" disabled={state.loading} onClick={run}>
                {state.loading ? 'Importing...' : 'Import as DRAFT'}
              </button>
            </div>
          </div>
        )}
        {step === 5 && (
          <div className="import-form">
            <div className="success-mark">✓</div>
            <h2>Import complete</h2>
            <p className="muted-copy">The backend created or updated supplier catalog records. Products remain DRAFT until reviewed and published.</p>
            <div className="result-grid">
              <div>
                <span>Created</span>
                <strong>{job?.counts?.createdRows || 0}</strong>
              </div>
              <div>
                <span>Updated</span>
                <strong>{job?.counts?.updatedRows || 0}</strong>
              </div>
              <div>
                <span>Rejected</span>
                <strong>{job?.counts?.failedRows || 0}</strong>
              </div>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setStep(1);
                setJob(null);
                setPreview(null);
                setFile(null);
              }}
            >
              Start another import
            </button>
          </div>
        )}
      </section>
    </>
  );
}
import React from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, ChevronLeft, ChevronRight, CircleUserRound, LayoutDashboard, LogOut, Menu, Search, ShieldCheck, X } from 'lucide-react';
import { clearAccessToken, getAccessToken } from '../services/authSession';
import { adminApi, adminResources } from '../services/adminApi';
import '../styles/admin.css';

const groups = [
  { label: 'Workspace', items: [{ label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard }] },
  {
    label: 'Catalog',
    items: ['Products', 'Categories', 'Brands', 'Attributes', 'Badges'].map(label => ({ label, path: `/admin/catalog/${label.toLowerCase()}` })),
  },
  {
    label: 'Dropshipping',
    items: [
      ['Supplier Catalog', 'supplier-catalog'],
      ['CSV Imports', 'imports'],
      ['Import History', 'import-history'],
      ['Pricing Rules', 'pricing'],
      ['Supplier Stock', 'stock'],
      ['Fulfillments', 'fulfillments'],
    ].map(([label, key]) => ({ label, path: `/admin/dropshipping/${key}` })),
  },
  {
    label: 'Sales',
    items: ['Orders', 'Returns', 'Refunds', 'Abandoned Carts'].map(label => ({ label, path: `/admin/sales/${label.toLowerCase().replaceAll(' ', '-')}` })),
  },
  {
    label: 'Inventory',
    items: [
      ['Overview', ''],
      ['Warehouses', 'warehouses'],
      ['Locations', 'locations'],
      ['Stock', 'stock'],
      ['Adjustments', 'adjustments'],
      ['Transfers', 'transfers'],
      ['Movements', 'movements'],
    ].map(([label, suffix]) => ({ label, path: `/admin/inventory${suffix ? `/${suffix}` : ''}` })),
  },
  { label: 'Customers', items: [{ label: 'Customers', path: '/admin/customers' }] },
  {
    label: 'Purchasing',
    items: [
      ['Suppliers', 'suppliers'],
      ['Purchase Orders', 'orders'],
      ['Goods Receipts', 'receipts'],
      ['Purchase Returns', 'returns'],
    ].map(([label, key]) => ({ label, path: `/admin/purchasing/${key}` })),
  },
  {
    label: 'Finance',
    items: [
      ['Dashboard', ''],
      ['Expenses', 'expenses'],
      ['Profit & Loss', 'profit-loss'],
    ].map(([label, key]) => ({ label, path: `/admin/finance${key ? `/${key}` : ''}` })),
  },
  {
    label: 'Reports',
    items: ['Sales', 'Products', 'Inventory', 'Customers', 'Orders', 'Purchases', 'Finance', 'Tax', 'Profit'].map(label => ({
      label,
      path: `/admin/reports/${label.toLowerCase()}`,
    })),
  },
  { label: 'Marketing', items: ['Coupons', 'Promotions', 'Banners', 'Homepage'].map(label => ({ label, path: `/admin/marketing/${label.toLowerCase()}` })) },
  { label: 'CMS', items: ['Pages', 'FAQ', 'Navigation', 'Policies'].map(label => ({ label, path: `/admin/cms/${label.toLowerCase()}` })) },
  {
    label: 'Settings',
    items: ['Store', 'Shipping', 'Tax', 'Invoice', 'Email', 'Social', 'SEO'].map(label => ({ label, path: `/admin/settings/${label.toLowerCase()}` })),
  },
  {
    label: 'System',
    items: [
      { label: 'Audit Logs', path: '/admin/system/audit-logs' },
      { label: 'Health', path: '/admin/system/health' },
    ],
  },
];
const loginRedirectState = { from: '/admin/dashboard', reason: 'expired' };

function readTokenClaims() {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const claims = JSON.parse(window.atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.exp && claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

function AdminGuard({ children }) {
  const claims = readTokenClaims();
  if (!claims) {
    clearAccessToken();
    return <Navigate to="/login" replace state={loginRedirectState} />;
  }
  if (claims.role !== 'SUPER_ADMIN') return <Navigate to="/" replace />;
  return children;
}

function Sidebar({ open, onClose, collapsed, onCollapse }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <aside className={`admin-sidebar ${open ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="admin-brand">
        <span className="brand-mark">M</span>
        {!collapsed && (
          <span>
            <strong>Mansoori</strong>
            <small>Kart ERP</small>
          </span>
        )}
        <button className="icon-button mobile-only" aria-label="Close navigation" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <nav className="admin-nav" aria-label="Super Admin navigation">
        {groups.map(group => (
          <section className="nav-group" key={group.label}>
            <p>{!collapsed && group.label}</p>
            {group.items.map(item => (
              <button
                key={item.path}
                className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                title={collapsed ? item.label : undefined}
                onClick={() => {
                  navigate(item.path);
                  onClose();
                }}
              >
                <span>{item.label.slice(0, 1)}</span>
                {!collapsed && item.label}
              </button>
            ))}
          </section>
        ))}
      </nav>
      <button className="collapse-button desktop-only" onClick={onCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? (
          <ChevronRight size={18} />
        ) : (
          <>
            <ChevronLeft size={18} /> Collapse
          </>
        )}
      </button>
    </aside>
  );
}

function Topbar({ onMenu }) {
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = React.useState(false);
  const logout = () => {
    clearAccessToken();
    navigate('/login');
  };
  return (
    <header className="admin-topbar">
      <button className="icon-button mobile-only" aria-label="Open navigation" onClick={onMenu}>
        <Menu size={21} />
      </button>
      <div className="global-search">
        <Search size={18} />
        <input aria-label="Search admin" placeholder="Search orders, products, customers..." />
      </div>
      <div className="topbar-actions">
        <button className="icon-button" aria-label="Notifications">
          <Bell size={19} />
          <i />
        </button>
        <div className="profile-wrap">
          <button className="profile-button" onClick={() => setProfileOpen(value => !value)}>
            <CircleUserRound size={21} />
            <span>Super Admin</span>
            <ChevronDown size={15} />
          </button>
          {profileOpen && (
            <div className="profile-menu">
              <div className="profile-heading">
                <ShieldCheck size={16} />
                <span>SUPER_ADMIN</span>
              </div>
              <button onClick={logout}>
                <LogOut size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function Breadcrumb({ title }) {
  return (
    <div className="admin-breadcrumb">
      <span>Workspace</span>
      <ChevronRight size={14} />
      <strong>{title}</strong>
    </div>
  );
}
function LoadingState() {
  return (
    <div className="admin-loading" role="status">
      <span />
      <span />
      <span /> Loading workspace data
    </div>
  );
}
function ErrorState({ message }) {
  return (
    <div className="admin-state error-state" role="alert">
      <strong>We could not load this view.</strong>
      <span>{message || 'Check the API connection and try again.'}</span>
    </div>
  );
}
function EmptyState() {
  return (
    <div className="admin-state">
      <strong>No records yet</strong>
      <span>When this area has data, it will appear here with server-side pagination.</span>
    </div>
  );
}
function ObjectView({ title, description, endpoint }) {
  const [state, setState] = React.useState({ loading: true, data: null, error: null });
  React.useEffect(() => {
    let active = true;
    adminApi
      .get(endpoint)
      .then(result => active && setState({ loading: false, data: result.data, error: null }))
      .catch(error => active && setState({ loading: false, data: null, error: error.normalizedMessage }));
    return () => {
      active = false;
    };
  }, [endpoint]);
  if (state.loading) return <LoadingState />;
  if (state.error) return <ErrorState message={state.error} />;
  const entries = Object.entries(state.data || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value));
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">Super Admin ERP</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <section className="panel">
        <div className="object-grid">
          {entries.length ? (
            entries.map(([key, value]) => (
              <div className="object-field" key={key}>
                <span>{key.replaceAll(/([A-Z])/g, ' $1')}</span>
                <strong>{String(value)}</strong>
              </div>
            ))
          ) : (
            <EmptyState />
          )}
        </div>
      </section>
    </>
  );
}

function Dashboard() {
  const [state, setState] = React.useState({ loading: true, data: null, sales: [], error: null });
  React.useEffect(() => {
    let active = true;
    Promise.all([adminApi.dashboard(), adminApi.dashboardSales('30d')])
      .then(([summary, sales]) => active && setState({ loading: false, data: summary.data, sales: Array.isArray(sales.data) ? sales.data : [], error: null }))
      .catch(error => active && setState({ loading: false, data: null, sales: [], error: error.normalizedMessage }));
    return () => {
      active = false;
    };
  }, []);
  if (state.loading) return <LoadingState />;
  if (state.error) return <ErrorState message={state.error} />;
  const data = state.data || {};
  const maxRevenue = Math.max(...state.sales.map(item => Number(item.revenue || 0)), 1);
  const stats = [
    ['Total revenue', `PKR ${Number(data.totalRevenue || 0).toLocaleString()}`, 'Realized orders'],
    ['Total orders', data.totalOrders || 0, `${data.pendingOrders || 0} pending`],
    ['Total products', data.totalProducts || 0, `${data.activeProducts || 0} active`],
    ['Customers', data.totalCustomers || 0, 'Customer accounts'],
    ['Low stock', data.lowStockProducts || 0, `${data.outOfStockProducts || 0} out of stock`],
    ['Fulfillment', data.processingOrders || 0, 'Processing orders'],
  ];
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">Operations overview</p>
          <h1>Good morning, Super Admin</h1>
          <p>One calm view of commerce, catalog, inventory, and fulfillment.</p>
        </div>
        <select aria-label="Dashboard range" defaultValue="30d">
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>
      <div className="stat-grid">
        {stats.map(([label, value, note]) => (
          <article className="stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Sales performance</p>
              <h2>Revenue and orders</h2>
            </div>
            <span className="live-chip">Live API</span>
          </div>
          {state.sales.length ? (
            <div className="chart-placeholder">
              <div className="chart-bars">
                {state.sales.slice(-14).map((item, index) => (
                  <i
                    key={item.date || index}
                    title={`${item.date}: PKR ${Number(item.revenue || 0).toLocaleString()}`}
                    style={{ height: `${Math.max(4, (Number(item.revenue || 0) / maxRevenue) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="chart-axis">
                <span>{state.sales[0]?.date || 'Earlier'}</span>
                <span>{state.sales[state.sales.length - 1]?.date || 'Today'}</span>
              </div>
            </div>
          ) : (
            <EmptyState />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Attention needed</p>
              <h2>Low stock products</h2>
            </div>
            <a href="/admin/inventory/stock">View all</a>
          </div>
          {data.lowStockItems?.length ? (
            <div className="compact-list">
              {data.lowStockItems.slice(0, 5).map(item => (
                <div className="compact-row" key={item.id}>
                  <span className="avatar">{item.name?.slice(0, 1)}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.status || 'ACTIVE'}</small>
                  </div>
                  <b>{item.stock} left</b>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState />
          )}
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Latest activity</p>
            <h2>Recent orders</h2>
          </div>
          <a href="/admin/sales/orders">Open orders</a>
        </div>
        {data.recentOrders?.length ? (
          <DataTable rows={data.recentOrders} columns={['orderNumber', 'customer', 'total', 'orderStatus', 'createdAt']} />
        ) : (
          <EmptyState />
        )}
      </section>
    </>
  );
}

function valueFor(row, column) {
  const value = row?.[column];
  if (column === 'customer' && value && typeof value === 'object') return value.name || value.email;
  if (value && typeof value === 'object') return value.name || value.code || value.email || JSON.stringify(value);
  if (column.toLowerCase().includes('date') || column.endsWith('At')) return value ? new Date(value).toLocaleDateString() : '—';
  return value ?? '—';
}
function DataTable({ rows, columns }) {
  return (
    <div className="table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column}>{column.replaceAll(/([A-Z])/g, ' $1')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id || row._id || index}>
              {columns.map(column => (
                <td key={column}>
                  <span className={column.toLowerCase().includes('status') ? 'status-pill' : ''}>{valueFor(row, column)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResourcePage({ resource, endpoint = resource.path }) {
  const [query, setQuery] = React.useState('');
  const [state, setState] = React.useState({ loading: true, rows: [], error: null });
  React.useEffect(() => {
    let active = true;
    setState(current => ({ ...current, loading: true }));
    adminApi
      .list(endpoint, { page: 1, limit: 25, search: query || undefined })
      .then(result => {
        const rows = Array.isArray(result.data) ? result.data : result.data?.items || result.data?.records || [];
        if (active) setState({ loading: false, rows, error: null });
      })
      .catch(error => active && setState({ loading: false, rows: [], error: error.normalizedMessage }));
    return () => {
      active = false;
    };
  }, [endpoint, query]);
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">Super Admin ERP</p>
          <h1>{resource.title}</h1>
          <p>{resource.description}</p>
        </div>
      </div>
      <section className="panel">
        <div className="toolbar">
          <div className="table-search">
            <Search size={17} />
            <input
              aria-label={`Search ${resource.title}`}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={`Search ${resource.title.toLowerCase()}...`}
            />
          </div>
          <button className="secondary-button">Filter</button>
          <button className="secondary-button">Columns</button>
        </div>
        {state.loading ? (
          <LoadingState />
        ) : state.error ? (
          <ErrorState message={state.error} />
        ) : state.rows.length ? (
          <DataTable rows={state.rows} columns={resource.columns} />
        ) : (
          <EmptyState />
        )}
      </section>
    </>
  );
}
function SpecialPage({ title, endpoint, description }) {
  return <ResourcePage resource={{ title, description, path: endpoint, columns: ['name', 'status', 'updatedAt'] }} endpoint={endpoint} />;
}
function AdminContent() {
  const { pathname: path } = useLocation();
  if (path === '/admin' || path === '/admin/dashboard') return <Dashboard />;
  if (path === '/admin/dropshipping/imports') return <CsvImportPage />;
  if (path === '/admin/dropshipping/stock' || path === '/admin/dropshipping/supplier-catalog')
    return <ResourcePage resource={adminResources.supplierCatalog} />;
  const exactResources = {
    '/admin/dropshipping/import-history': adminResources.imports,
    '/admin/dropshipping/pricing': adminResources.pricing,
    '/admin/dropshipping/fulfillments': adminResources.fulfillments,
    '/admin/sales/orders': adminResources.orders,
    '/admin/sales/returns': adminResources.returns,
    '/admin/sales/refunds': adminResources.refunds,
    '/admin/sales/abandoned-carts': adminResources.abandonedCarts,
    '/admin/purchasing/suppliers': adminResources.suppliers,
    '/admin/purchasing/orders': adminResources.purchaseOrders,
    '/admin/purchasing/receipts': adminResources.receipts,
    '/admin/purchasing/returns': {
      title: 'Purchase Returns',
      description: 'Supplier returns and inventory effects.',
      path: '/purchase-returns',
      columns: ['supplier', 'status', 'createdAt'],
    },
    '/admin/reports/sales': adminResources.reportsSales,
    '/admin/reports/products': adminResources.reportsProducts,
    '/admin/reports/inventory': adminResources.reportsInventory,
    '/admin/reports/customers': adminResources.reportsCustomers,
    '/admin/reports/orders': adminResources.reportsOrders,
    '/admin/reports/purchases': adminResources.reportsPurchases,
    '/admin/reports/tax': adminResources.reportsTax,
    '/admin/reports/profit': adminResources.reportsProfit,
  };
  if (exactResources[path]) return <ResourcePage resource={exactResources[path]} />;
  if (path.includes('/system/health'))
    return <ObjectView title="System Health" endpoint="/system/health" description="Safe operational status from the versioned API." />;
  if (path.includes('/system/audit-logs'))
    return <SpecialPage title="Audit Logs" endpoint="/audit-logs" description="Immutable operator activity with safe metadata." />;
  if (path.includes('/finance/profit-loss'))
    return <ObjectView title="Profit & Loss" endpoint="/finance/profit-loss" description="Revenue, COGS, expenses, and profit from the finance authority." />;
  if (path === '/admin/finance')
    return <ObjectView title="Finance Dashboard" endpoint="/finance/dashboard" description="Management finance metrics from persisted commerce records." />;
  if (path.includes('/settings/'))
    return (
      <ObjectView
        title={`${path.split('/').pop().replace('-', ' ')} settings`}
        endpoint="/settings"
        description="Typed store configuration with safe fields only."
      />
    );
  if (path.includes('/marketing/homepage'))
    return <ObjectView title="Homepage Configuration" endpoint="/homepage" description="Curated storefront sections and operator ordering." />;
  if (path.includes('/cms/navigation'))
    return <ObjectView title="Navigation Configuration" endpoint="/navigation/header" description="Reachable storefront navigation managed by the operator." />;
  if (path.includes('/inventory/adjustments') || path.includes('/inventory/transfers'))
    return (
      <SpecialPage
        title={path.includes('adjustments') ? 'Inventory Adjustments' : 'Inventory Transfers'}
        endpoint="/inventory/dashboard"
        description="Inventory mutations require explicit confirmation and server authority."
      />
    );
  const match = Object.values(adminResources).find(resource => path.endsWith(resource.path) || path.includes(resource.path));
  return (
    <ResourcePage
      resource={match || { title: 'Admin workspace', description: 'Select a module from the navigation.', path: '/dashboard', columns: [] }}
      endpoint={match?.path || '/dashboard'}
    />
  );
}

export default function AdminApp() {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const location = useLocation();
  const title =
    groups.flatMap(group => group.items).find(item => item.path === location.pathname)?.label ||
    (location.pathname === '/admin/dashboard' ? 'Dashboard' : 'Admin workspace');
  return (
    <AdminGuard>
      <div className="admin-app">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} collapsed={collapsed} onCollapse={() => setCollapsed(value => !value)} />
        <div className="admin-main">
          <Topbar onMenu={() => setSidebarOpen(true)} />
          <main className="admin-content">
            <Breadcrumb title={title} />
            <Routes>
              <Route path="*" element={<AdminContent />} />
            </Routes>
          </main>
        </div>
        {sidebarOpen && <button className="drawer-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      </div>
    </AdminGuard>
  );
}
