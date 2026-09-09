import * as React from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Box, Container, CssBaseline } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import NavigationBar from './components/NavigationBar';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';
import { AdminGuard } from './components/admin/AdminGuard';
import { AdminLayout } from './components/admin/AdminLayout';
import Home from './pages/Home';
import Shop from './pages/Shop';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import OrderSuccess from './pages/OrderSuccess';
import ProductDetails from './pages/ProductDetails';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import NotFoundPage from './pages/NotFoundPage';
import About from './pages/About';
import Support from './pages/Support';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import ShippingReturns from './pages/ShippingReturns';
import OrderTracking from './pages/OrderTracking';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminPlaceholder from './pages/admin/AdminPlaceholder';
import CatalogImportsPage from './pages/admin/CatalogImportsPage';
import ProductsPage from './pages/admin/ProductsPage';
import PricingPage from './pages/admin/PricingPage';
import OrdersPage from './pages/admin/OrdersPage';
import { fetchAllProducts } from './services/catalog';
import { useNotifier } from './context/NotificationProvider';

const theme = createTheme({
  palette: {
    primary: { main: '#2874f0' },
    secondary: { main: '#f50057' },
    background: { default: '#f4f7fb', paper: '#ffffff' },
    text: { primary: '#1f2933', secondary: '#4b5563' },
  },
  typography: {
    fontFamily: 'Poppins, sans-serif',
    h3: { fontWeight: 700 },
    h4: { fontWeight: 700 },
    button: { fontWeight: 600, textTransform: 'none' },
  },
  shape: { borderRadius: 14 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 999, textTransform: 'none', paddingInline: 20 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { borderRadius: 18, boxShadow: '0 16px 30px rgba(40, 116, 240, 0.08)' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 18, boxShadow: '0 18px 42px rgba(15, 23, 42, 0.08)' },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: '#f4f7fb' },
      },
    },
  },
});

function StorefrontLayout() {
  const [products, setProducts] = React.useState([]);
  const [cart, setCart] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const { notify } = useNotifier();

  React.useEffect(() => {
    try {
      const storedCart = JSON.parse(localStorage.getItem('mansoorikart_cart') || localStorage.getItem('fusionCart'));
      if (Array.isArray(storedCart) && storedCart.length) {
        setCart(storedCart);
        localStorage.setItem('mansoorikart_cart', JSON.stringify(storedCart));
        localStorage.removeItem('fusionCart');
      }
    } catch (storageError) {
      console.warn('Unable to restore saved cart', storageError);
    }
  }, []);

  React.useEffect(() => {
    localStorage.setItem('mansoorikart_cart', JSON.stringify(cart));
  }, [cart]);

  React.useEffect(() => {
    let active = true;

    const loadProducts = async () => {
      setError(null);
      try {
        const normalized = await fetchAllProducts();
        if (!active) return;
        setProducts(normalized);

        let removedCount = 0;
        setCart(prevCart => {
          if (!Array.isArray(prevCart) || !prevCart.length) return prevCart;
          const validIds = new Set(normalized.map(item => String(item.id)));
          const sanitized = prevCart.filter(item => {
            const itemId = item?._id || item?.id;
            return itemId && validIds.has(String(itemId));
          });
          removedCount = prevCart.length - sanitized.length;
          return sanitized;
        });

        if (removedCount > 0) {
          notify({ severity: 'info', message: 'We refreshed your cart to remove items that are no longer available.' });
        }
      } catch (err) {
        if (!active) return;
        console.error('Error fetching products:', err);
        setProducts([]);
        setError(err);
        notify({ severity: 'error', message: 'Unable to load products. Please try again shortly.' });
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadProducts();
    return () => {
      active = false;
    };
  }, [notify]);

  const addToCart = React.useCallback(
    product => {
      if (!product) return;
      const canonicalId = product._id || product.id;
      if (!canonicalId) {
        notify({ severity: 'error', message: 'Unable to add this product right now.' });
        return;
      }

      setCart(prevCart => {
        const alreadyInCart = prevCart.some(item => item.id === canonicalId || item._id === canonicalId);
        if (alreadyInCart) {
          notify({ severity: 'info', message: 'Item is already in your cart.' });
          return prevCart;
        }
        notify({ severity: 'success', message: 'Added to cart!' });
        return [...prevCart, { ...product, id: canonicalId, _id: canonicalId }];
      });
    },
    [notify]
  );

  const handleOrderComplete = React.useCallback(
    purchasedIds => {
      const completed = new Set(purchasedIds || []);
      setCart(current => current.filter(item => !completed.has(item.id || item._id)));
      notify({ severity: 'success', message: 'Thank you for your order!' });
    },
    [notify]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ScrollToTop />
      <NavigationBar cartItemCount={cart.length} />
      <Box component="main" sx={{ minHeight: 'calc(100vh - 200px)' }}>
        <Container maxWidth="xl" sx={{ pb: 8 }}>
          <Routes>
            <Route path="/" element={<Home products={products} loading={loading} error={error} addToCart={addToCart} />} />
            <Route path="/shop" element={<Shop products={products} addToCart={addToCart} loading={loading} error={error} />} />
            <Route path="/about" element={<About />} />
            <Route path="/support" element={<Support />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/shipping-returns" element={<ShippingReturns />} />
            <Route path="/order-tracking" element={<OrderTracking />} />
            <Route path="/cart" element={<Cart cart={cart} setCart={setCart} />} />
            <Route path="/checkout" element={<Checkout cartItems={cart} onOrderComplete={handleOrderComplete} />} />
            <Route path="/order-success" element={<OrderSuccess />} />
            <Route path="/product/:id" element={<ProductDetails addToCart={addToCart} />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Container>
      </Box>
      <Footer />
    </ThemeProvider>
  );
}

function ProtectedAdminLayout() {
  return (
    <AdminGuard>
      <AdminLayout />
    </AdminGuard>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<ProtectedAdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="imports" element={<CatalogImportsPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="suppliers" element={<AdminPlaceholder />} />
          <Route path="customers" element={<AdminPlaceholder />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
        <Route path="*" element={<StorefrontLayout />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
