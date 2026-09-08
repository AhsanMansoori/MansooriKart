import * as React from 'react';
import { Link } from 'react-router-dom';
import { Mail, Send } from 'lucide-react';
import { useNotifier } from '../context/NotificationProvider';

const explore = [
  ['Home', '/'],
  ['Shop', '/shop'],
  ['About', '/about'],
  ['Support', '/support'],
  ['Cart', '/cart'],
];
const care = [
  ['Order Tracking', '/order-tracking'],
  ['Shipping & Returns', '/shipping-returns'],
  ['Terms & Conditions', '/terms'],
  ['Privacy Policy', '/privacy'],
  ['FAQ', '/support#faq'],
  ['Contact Us', '/support#contact'],
];
const policies = [
  ['Privacy', '/privacy'],
  ['Terms', '/terms'],
  ['Shipping & Returns', '/shipping-returns'],
  ['Track Order', '/order-tracking'],
  ['Contact', '/support#contact'],
];

function Footer() {
  const [email, setEmail] = React.useState('');
  const { notify } = useNotifier();
  const submit = event => {
    event.preventDefault();
    if (!/[^@\s]+@[^@\s]+\.[^@\s]+/.test(email.trim())) return notify({ severity: 'warning', message: 'Enter a valid email address.' });
    notify({ severity: 'success', message: 'You are on the VIP list! Look out for our next drop.' });
    setEmail('');
  };
  const links = items => (
    <ul className="space-y-2">
      {items.map(([label, to]) => (
        <li key={to}>
          <Link className="text-sm text-slate-300 hover:text-white" to={to}>
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <footer className="mt-8 bg-gradient-to-br from-deep-navy to-navy text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <section>
          <h2 className="text-lg font-extrabold tracking-[0.12em]">MANSOORIKART</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Curating gadgets, smart-home essentials, and premium accessories to help you live smarter every day.
          </p>
          <div className="mt-4 flex gap-2">
            <a
              aria-label="GitHub"
              className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
              href="https://github.com/hoangsonww"
              target="_blank"
              rel="noreferrer"
            >
              GH
            </a>
            <a
              aria-label="LinkedIn"
              className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
              href="https://www.linkedin.com/in/hoangsonw/"
              target="_blank"
              rel="noreferrer"
            >
              in
            </a>
            <a aria-label="Email" className="rounded bg-white/10 p-2 hover:bg-white/20" href="mailto:hoangson091104@gmail.com">
              <Mail size={18} />
            </a>
          </div>
        </section>
        <nav aria-label="Explore">
          <h2 className="mb-3 font-bold">Explore</h2>
          {links(explore)}
        </nav>
        <nav aria-label="Customer care">
          <h2 className="mb-3 font-bold">Customer Care</h2>
          {links(care)}
        </nav>
        <section>
          <h2 className="font-bold">Join the Insider List</h2>
          <p className="mt-3 text-sm text-slate-300">Unlock early access to product drops and buying guides.</p>
          <form className="mt-4 flex gap-2" onSubmit={submit}>
            <input
              aria-label="Email address"
              className="min-h-10 min-w-0 flex-1 rounded-mk px-3 text-text outline-none"
              type="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="your@email.com"
            />
            <button aria-label="Subscribe" className="rounded-mk bg-gold px-3 text-deep-navy hover:bg-orange">
              <Send size={18} />
            </button>
          </form>
          <p className="mt-3 text-xs text-slate-300">We respect your inbox.</p>
        </section>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-3 border-t border-white/15 px-4 py-6 text-sm text-slate-300 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <span>© {new Date().getFullYear()} MansooriKart. Crafted for everyday tech.</span>
        <nav aria-label="Policy links" className="flex flex-wrap gap-x-4 gap-y-2">
          {policies.map(([label, to]) => (
            <Link key={to} className="hover:text-white" to={to}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export default Footer;