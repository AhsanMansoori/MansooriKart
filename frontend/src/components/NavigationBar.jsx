import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { debounce } from 'lodash';
import { Menu, Search, ShoppingCart, LogIn, UserPlus, LogOut, X } from 'lucide-react';
import SearchResults from './SearchResults';
import { apiClient } from '../services/apiClient';
import { useNotifier } from '../context/NotificationProvider';

const navLinks = [
  { label: 'Home', to: '/' },
  { label: 'Shop', to: '/shop' },
  { label: 'About', to: '/about' },
  { label: 'Support', to: '/support' },
];

function NavigationBar({ cartItemCount }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);
  const searchInputRef = React.useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { notify } = useNotifier();

  React.useEffect(() => {
    const checkToken = () =>
      setIsLoggedIn(Boolean(localStorage.getItem('mansoorikart_access_token') || localStorage.getItem('MERNEcommerceToken') || localStorage.getItem('token')));
    checkToken();
    const interval = window.setInterval(checkToken, 2000);
    return () => window.clearInterval(interval);
  }, []);

  const search = React.useMemo(
    () =>
      debounce(async query => {
        if (!query.trim()) return setSearchResults([]);
        setLoading(true);
        try {
          const { data } = await apiClient.get('search', { params: { q: query } });
          setSearchResults(Array.isArray(data) ? data : []);
        } catch {
          setSearchResults([]);
          notify({ severity: 'error', message: 'Search is unavailable right now.' });
        } finally {
          setLoading(false);
        }
      }, 320),
    [notify]
  );

  React.useEffect(() => () => search.cancel(), [search]);
  React.useEffect(() => {
    setMenuOpen(false);
    setSearchResults([]);
  }, [location.pathname]);
  React.useEffect(() => {
    const onKeyDown = event => event.key === 'Escape' && (setMenuOpen(false), setSearchOpen(false));
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    search.cancel();
  };
  const openSearch = () => {
    setSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };
  const logout = () => {
    localStorage.removeItem('mansoorikart_access_token');
    localStorage.removeItem('MERNEcommerceToken');
    localStorage.removeItem('token');
    setIsLoggedIn(false);
    notify({ severity: 'success', message: 'Signed out successfully.' });
    navigate('/');
  };
  const changeSearch = event => {
    const value = event.target.value;
    setSearchQuery(value);
    search(value);
  };
  const route = to => {
    setMenuOpen(false);
    navigate(to);
  };

  return (
    <header className="sticky top-0 z-40 mb-8 bg-gradient-to-r from-deep-navy via-navy to-[#3154d0] text-white shadow-mk">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          className="rounded p-2 hover:bg-white/15 lg:hidden"
          aria-label="Open navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(value => !value)}
        >
          <Menu />
        </button>
        <Link to="/" className="shrink-0 font-bold tracking-[0.12em] text-white">
          MANSOORIKART
        </Link>
        <span className="hidden text-xs text-white/70 xl:block">Elevate Your Everyday Tech</span>
        <nav aria-label="Primary navigation" className="ml-auto hidden items-center gap-1 lg:flex">
          {navLinks.map(link => (
            <Link key={link.to} to={link.to} className={`rounded px-3 py-2 text-sm hover:bg-white/15 ${location.pathname === link.to ? 'bg-white/20' : ''}`}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="relative hidden min-w-0 flex-1 md:block lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/70" />
          <input
            aria-label="Search"
            value={searchQuery}
            onChange={changeSearch}
            placeholder="Search gadgets, accessories..."
            className="h-10 w-full rounded-full bg-white/15 pl-10 pr-3 text-sm text-white placeholder:text-white/70 outline-none focus:bg-white/20"
          />
          {loading && <span className="absolute right-3 top-3 text-xs">…</span>}
          {searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-12 rounded-mk bg-white p-2 text-text shadow-mk">
              <SearchResults results={searchResults} onResultClick={() => setSearchResults([])} setSearchResults={setSearchResults} />
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1 lg:ml-2">
          <button aria-label="Search products" className="rounded p-2 hover:bg-white/15 md:hidden" onClick={openSearch}>
            <Search />
          </button>
          {isLoggedIn ? (
            <button aria-label="Sign out" className="rounded p-2 text-gold hover:bg-white/15" onClick={logout}>
              <LogOut />
            </button>
          ) : (
            <>
              <Link aria-label="Sign in" className="rounded p-2 hover:bg-white/15" to="/login">
                <LogIn />
              </Link>
              <Link aria-label="Create account" className="rounded p-2 hover:bg-white/15" to="/register">
                <UserPlus />
              </Link>
            </>
          )}
          <Link aria-label="View cart" className="relative rounded p-2 hover:bg-white/15" to="/cart">
            <ShoppingCart />
            <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-gold px-1 text-center text-xs font-bold text-deep-navy">{cartItemCount}</span>
          </Link>
        </div>
      </div>
      {menuOpen && (
        <div className="border-t border-white/15 bg-deep-navy px-4 py-3 lg:hidden">
          <nav aria-label="Mobile navigation" className="grid gap-1">
            {navLinks.map(link => (
              <button key={link.to} className="rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => route(link.to)}>
                {link.label}
              </button>
            ))}
            <button className="rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => route('/cart')}>
              Cart ({cartItemCount})
            </button>
            {isLoggedIn ? (
              <button className="rounded px-3 py-2 text-left hover:bg-white/10" onClick={logout}>
                Logout
              </button>
            ) : (
              <>
                <button className="rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => route('/login')}>
                  Login
                </button>
                <button className="rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => route('/register')}>
                  Register
                </button>
              </>
            )}
          </nav>
        </div>
      )}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-deep-navy/70 p-4">
          <div className="mx-auto mt-16 max-w-xl rounded-mk bg-white p-4 text-text shadow-mk">
            <div className="flex items-center gap-2">
              <Search className="text-muted" />
              <input
                ref={searchInputRef}
                aria-label="Search products"
                value={searchQuery}
                onChange={changeSearch}
                className="min-h-10 flex-1 outline-none"
                placeholder="Search gadgets, accessories..."
              />
              <button aria-label="Close search" onClick={closeSearch}>
                <X />
              </button>
            </div>
            <div className="mt-3">
              {loading ? (
                'Searching…'
              ) : searchResults.length ? (
                <SearchResults results={searchResults} onResultClick={closeSearch} setSearchResults={setSearchResults} />
              ) : searchQuery.trim() ? (
                'No products matched your search yet.'
              ) : (
                'Start typing to explore our catalog.'
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export default NavigationBar;
