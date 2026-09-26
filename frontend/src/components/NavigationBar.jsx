import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { debounce } from 'lodash';
import { Menu, Search, ShoppingCart, LogIn, UserPlus, LogOut, X } from 'lucide-react';

import SearchResults from './SearchResults';
import { searchProducts } from '../services/catalog';
import { clearAccessToken, isAuthenticated } from '../services/authSession';
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
  const [isScrolled, setIsScrolled] = React.useState(false);

  const searchInputRef = React.useRef(null);

  const location = useLocation();
  const navigate = useNavigate();
  const { notify } = useNotifier();

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 40);
    };

    handleScroll();

    window.addEventListener('scroll', handleScroll, {
      passive: true,
    });

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  React.useEffect(() => {
    const checkToken = () => setIsLoggedIn(isAuthenticated());

    checkToken();

    const interval = window.setInterval(checkToken, 2000);

    return () => window.clearInterval(interval);
  }, []);

  const search = React.useMemo(
    () =>
      debounce(async query => {
        if (!query.trim()) {
          setSearchResults([]);
          return;
        }

        setLoading(true);

        try {
          setSearchResults(await searchProducts(query.trim()));
        } catch {
          setSearchResults([]);

          notify({
            severity: 'error',
            message: 'Search is unavailable right now.',
          });
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
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setSearchOpen(false);
      }
    };

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

    window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  };

  const logout = () => {
    clearAccessToken();
    setIsLoggedIn(false);

    notify({
      severity: 'success',
      message: 'Signed out successfully.',
    });

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
    <>
      {/* Reserved space prevents layout jump */}
      <div className="h-16 md:h-[72px]" />

      <header
        className={`
          fixed left-1/2 z-50 -translate-x-1/2
          bg-gradient-to-r from-[#18C19F] to-[#8BF3AF]
          text-white
          transition-all duration-300 ease-out

          ${
            isScrolled
              ? `
                top-3
                w-[calc(100%-24px)]
                rounded-2xl
                border border-white/20
                bg-gradient-to-r
                from-[#18C19F]/95
                to-[#8BF3AF]/95
                shadow-[0_16px_40px_rgba(13,31,51,0.18)]
                backdrop-blur-xl

                sm:top-4
                sm:w-[calc(100%-32px)]
                lg:w-[min(1180px,calc(100%-48px))]
              `
              : `
                top-0
                w-full
                rounded-none
                shadow-mk
              `
          }
        `}
      >
        <div
          className={`
            mx-auto flex items-center gap-2 px-4
            transition-all duration-300 ease-out
            sm:px-6

            ${isScrolled ? 'min-h-[58px] lg:px-5' : 'min-h-16 lg:px-8'}
          `}
        >
          {/* Mobile menu */}
          <button
            className="
              rounded-xl p-2
              transition-colors
              hover:bg-white/15
              focus-visible:outline-none
              focus-visible:ring-2
              focus-visible:ring-white/70
              lg:hidden
            "
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(value => !value)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>

          {/* Brand */}
          <Link
            to="/"
            className="
              flex shrink-0 items-center gap-2
              rounded-xl
              focus-visible:outline-none
              focus-visible:ring-2
              focus-visible:ring-white/70
            "
          >
            <span
              className="
                flex size-9 items-center justify-center
                rounded-xl
                border border-white/20
                bg-white/15
                text-xs font-black
                tracking-tight
                shadow-sm
                backdrop-blur-sm
              "
            >
              MK
            </span>

            <span className="hidden font-bold tracking-[0.11em] sm:inline">MANSOORIKART</span>
          </Link>

          {/* Desktop navigation */}
          <nav
            aria-label="Primary navigation"
            className={`
              hidden items-center lg:flex
              ${isScrolled ? 'ml-4 gap-0.5' : 'ml-auto gap-1'}
            `}
          >
            {navLinks.map(link => {
              const active = location.pathname === link.to;

              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`
                    rounded-xl px-3 py-2 text-sm font-medium
                    transition-all duration-200
                    focus-visible:outline-none
                    focus-visible:ring-2
                    focus-visible:ring-white/70

                    ${active ? 'bg-white/20 text-white' : 'text-white/90 hover:bg-white/10 hover:text-white'}
                  `}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Desktop search */}
          <div
            className={`
              relative hidden min-w-0 flex-1 md:block
              transition-all duration-300

              ${isScrolled ? 'ml-auto lg:max-w-[300px]' : 'lg:max-w-sm'}
            `}
          >
            <Search
              className="
                pointer-events-none
                absolute left-3 top-1/2
                size-4 -translate-y-1/2
                text-white/70
              "
            />

            <input
              aria-label="Search"
              value={searchQuery}
              onChange={changeSearch}
              placeholder="Search gadgets, accessories..."
              className="
                h-10 w-full
                rounded-full
                border border-white/10
                bg-white/15
                pl-10 pr-9
                text-sm text-white
                outline-none
                transition-all
                placeholder:text-white/70
                hover:bg-white/20
                focus:border-white/30
                focus:bg-white/20
                focus:ring-2
                focus:ring-white/20
              "
            />

            {loading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs">…</span>}

            {searchResults.length > 0 && (
              <div
                className="
                  absolute left-0 right-0 top-12
                  z-[70]
                  max-h-[420px]
                  overflow-y-auto
                  rounded-2xl
                  border border-slate-200
                  bg-white
                  p-2
                  text-text
                  shadow-2xl
                "
              >
                <SearchResults results={searchResults} onResultClick={() => setSearchResults([])} setSearchResults={setSearchResults} />
              </div>
            )}
          </div>

          {/* Right actions */}
          <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-2">
            {/* Mobile search */}
            <button
              aria-label="Search products"
              className="
                rounded-xl p-2
                transition-colors
                hover:bg-white/15
                focus-visible:outline-none
                focus-visible:ring-2
                focus-visible:ring-white/70
                md:hidden
              "
              onClick={openSearch}
            >
              <Search className="size-5" />
            </button>

            {isLoggedIn ? (
              <button
                aria-label="Sign out"
                className="
                  rounded-xl p-2
                  transition-colors
                  hover:bg-white/15
                  focus-visible:outline-none
                  focus-visible:ring-2
                  focus-visible:ring-white/70
                "
                onClick={logout}
              >
                <LogOut className="size-5" />
              </button>
            ) : (
              <>
                <Link
                  aria-label="Sign in"
                  className="
                    rounded-xl p-2
                    transition-colors
                    hover:bg-white/15
                    focus-visible:outline-none
                    focus-visible:ring-2
                    focus-visible:ring-white/70
                  "
                  to="/login"
                >
                  <LogIn className="size-5" />
                </Link>

                <Link
                  aria-label="Create account"
                  className="
                    hidden rounded-xl p-2
                    transition-colors
                    hover:bg-white/15
                    focus-visible:outline-none
                    focus-visible:ring-2
                    focus-visible:ring-white/70
                    sm:inline-flex
                  "
                  to="/register"
                >
                  <UserPlus className="size-5" />
                </Link>
              </>
            )}

            <Link
              aria-label="View cart"
              className="
                relative rounded-xl p-2
                transition-colors
                hover:bg-white/15
                focus-visible:outline-none
                focus-visible:ring-2
                focus-visible:ring-white/70
              "
              to="/cart"
            >
              <ShoppingCart className="size-5" />

              {cartItemCount > 0 && (
                <span
                  className="
                    absolute -right-1 -top-1
                    flex min-w-5 items-center justify-center
                    rounded-full
                    bg-gold
                    px-1
                    text-[11px] font-bold
                    leading-5
                    text-deep-navy
                    shadow-sm
                  "
                >
                  {cartItemCount > 99 ? '99+' : cartItemCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* Mobile navigation */}
        {menuOpen && (
          <div
            className={`
              mx-2 mb-2
              border-t border-white/15
              bg-deep-navy/95
              px-3 py-3
              shadow-xl
              backdrop-blur-xl
              lg:hidden

              ${isScrolled ? 'rounded-b-2xl' : 'mx-0 mb-0 rounded-none'}
            `}
          >
            <nav aria-label="Mobile navigation" className="grid gap-1">
              {navLinks.map(link => (
                <button
                  key={link.to}
                  className={`
                    rounded-xl px-3 py-2.5 text-left
                    transition-colors
                    hover:bg-white/10

                    ${location.pathname === link.to ? 'bg-white/10' : ''}
                  `}
                  onClick={() => route(link.to)}
                >
                  {link.label}
                </button>
              ))}

              <button className="rounded-xl px-3 py-2.5 text-left hover:bg-white/10" onClick={() => route('/cart')}>
                Cart ({cartItemCount})
              </button>

              {isLoggedIn ? (
                <button className="rounded-xl px-3 py-2.5 text-left hover:bg-white/10" onClick={logout}>
                  Logout
                </button>
              ) : (
                <>
                  <button className="rounded-xl px-3 py-2.5 text-left hover:bg-white/10" onClick={() => route('/login')}>
                    Login
                  </button>

                  <button className="rounded-xl px-3 py-2.5 text-left hover:bg-white/10" onClick={() => route('/register')}>
                    Register
                  </button>
                </>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Mobile search overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-[100] bg-deep-navy/70 p-4 backdrop-blur-sm">
          <div className="mx-auto mt-16 max-w-xl rounded-2xl bg-white p-4 text-text shadow-2xl">
            <div className="flex items-center gap-2">
              <Search className="text-muted" />

              <input
                ref={searchInputRef}
                aria-label="Search products"
                value={searchQuery}
                onChange={changeSearch}
                className="
                  min-h-10 flex-1
                  border-none
                  outline-none
                  focus:ring-0
                "
                placeholder="Search gadgets, accessories..."
              />

              <button
                aria-label="Close search"
                className="
                  rounded-lg p-2
                  hover:bg-slate-100
                  focus-visible:outline-none
                  focus-visible:ring-2
                  focus-visible:ring-[#18C19F]
                "
                onClick={closeSearch}
              >
                <X className="size-5" />
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
    </>
  );
}

export default NavigationBar;
