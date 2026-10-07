'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, ShoppingBag, Heart, User, Settings, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button, Input } from '@mansoorikart/ui';
import { useAuth } from '../../components/providers';

const BenefitItem = ({ icon: Icon, title, desc }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) => (
  <div className="flex items-center gap-4 group">
    <div className="bg-white p-2.5 rounded-2xl text-brand-teal shadow-xs group-hover:scale-110 transition-transform">
      <Icon className="w-5 h-5" />
    </div>
    <div>
      <h4 className="text-sm font-bold text-brand-navy">{title}</h4>
      <p className="text-[11px] text-text-secondary">{desc}</p>
    </div>
  </div>
);

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const ok = await login(email, password);
      if (ok) router.push('/account');
      else setError('Invalid email or password.');
    } catch {
      setError('Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface-canvas min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-6xl bg-white rounded-3xl shadow-card overflow-hidden grid grid-cols-1 lg:grid-cols-2 border border-slate-100">
        {/* LEFT SIDE: Visuals & Benefits */}
        <div className="bg-gradient-to-br from-surface-mint to-surface-teal p-8 sm:p-12 relative overflow-hidden flex flex-col justify-between">
          <div className="relative z-10">
            <div className="mb-6">
              <Link href="/">
                <Image src="/logo.svg" alt="MansooriKart - Shop More Live Better" width={170} height={34} className="h-8 w-auto object-contain" priority />
              </Link>
            </div>

            <span className="inline-block bg-white text-brand-teal px-3.5 py-1 rounded-full text-[10px] font-bold tracking-widest mb-6 shadow-xs border border-border-mint">
              WELCOME BACK
            </span>

            <h2 className="text-4xl sm:text-5xl font-black leading-[1.1] mb-6">
              <span className="text-brand-navy">Good to see</span> <br />
              <span className="text-brand-teal">you again!</span>
            </h2>

            <p className="text-xs sm:text-sm text-text-secondary max-w-sm mb-8 leading-relaxed">
              Log in to your MansooriKart account to continue shopping, track live orders, manage your wishlist, and more.
            </p>

            <div className="space-y-4">
              <BenefitItem icon={ShoppingBag} title="Track Your Orders" desc="Get real-time updates on your UAE purchases" />
              <BenefitItem icon={Heart} title="Save Your Favorites" desc="Keep track of the electronics and products you love" />
              <BenefitItem icon={User} title="A Personalized Experience" desc="Get tailor-made recommendations" />
              <BenefitItem icon={Settings} title="Manage Your Account" desc="Update UAE addresses, profile, and preferences" />
            </div>
          </div>

          {/* Slogan */}
          <div className="relative z-10 mt-10 pt-6 border-t border-brand-teal/10 flex items-center justify-between">
            <p className="font-serif italic text-2xl text-brand-navy opacity-85">
              Shop More <br /> Live Better
            </p>
            <span className="text-[10px] font-bold text-brand-teal uppercase tracking-wider bg-white/80 px-3 py-1 rounded-full border border-border-mint">
              UAE Express Delivery
            </span>
          </div>

          {/* Background glow decoration */}
          <div className="absolute bottom-0 right-0 w-64 h-64 bg-gradient-to-tr from-brand-mint/20 to-brand-teal/10 rounded-full blur-3xl pointer-events-none" />
        </div>

        {/* RIGHT SIDE: Login Form */}
        <div className="p-8 sm:p-12 lg:p-16 flex flex-col justify-center bg-white">
          <div className="max-w-md mx-auto w-full space-y-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-brand-navy tracking-tight">Login to your account</h1>
              <p className="text-xs sm:text-sm text-text-secondary mt-1">Welcome back! Please enter your details to continue.</p>
            </div>

            {error && <div className="p-3 rounded-xl bg-brand-red-light text-brand-red-dark text-xs font-semibold">{error}</div>}

            {/* Social Logins */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className="flex items-center justify-center gap-2 border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all cursor-pointer"
              >
                <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-4 h-4" alt="Google" />
                Google
              </button>
              <button
                type="button"
                className="flex items-center justify-center gap-2 border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all cursor-pointer"
              >
                <img src="https://www.svgrepo.com/show/303108/apple-black-logo.svg" className="w-4 h-4" alt="Apple" />
                Apple
              </button>
            </div>

            <div className="relative flex items-center">
              <div className="flex-grow border-t border-slate-100" />
              <span className="flex-shrink mx-4 text-[10px] font-bold text-text-muted tracking-widest uppercase">OR</span>
              <div className="flex-grow border-t border-slate-100" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Email Address *</label>
                <div className="relative">
                  <Input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl pl-10"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Password *</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl pl-10 pr-10"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-teal cursor-pointer"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="rounded-sm border-slate-300 text-brand-teal focus:ring-brand-teal"
                  />
                  Remember me
                </label>
                <Link href="/forgot-password" className="text-brand-teal font-bold hover:underline">
                  Forgot password?
                </Link>
              </div>

              <Button
                type="submit"
                disabled={loading}
                variant="primary"
                size="lg"
                className="w-full rounded-2xl font-bold text-sm shadow-md shadow-brand-mint/20 mt-2 gap-2"
              >
                {loading ? 'Logging in...' : 'Login'} <ArrowRight className="w-4 h-4" />
              </Button>
            </form>

            <p className="text-center text-xs text-text-secondary pt-2">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="font-bold text-brand-teal hover:underline">
                Create a new account
              </Link>
            </p>

            {/* Secure Badge */}
            <div className="flex items-center gap-3 bg-surface-canvas p-3.5 rounded-2xl border border-slate-100">
              <div className="bg-surface-mint p-2 rounded-xl text-brand-mint">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-brand-navy">Secure UAE Login</p>
                <p className="text-[11px] text-text-secondary">256-bit encrypted authentication & account protection.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
