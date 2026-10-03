'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ShoppingBag,
  Heart,
  User,
  Settings,
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import { Button, Input } from '@mansoorikart/ui';
import { useAuth } from '../../components/providers';

// Custom component for the list items on the left
const BenefitItem = ({ icon: Icon, title, desc }: { icon: any, title: string, desc: string }) => (
  <div className="flex items-center gap-4 group">
    <div className="bg-white p-2.5 rounded-2xl text-[#00D094] shadow-sm group-hover:scale-110 transition-transform">
      <Icon className="w-5 h-5" />
    </div>
    <div>
      <h4 className="text-sm font-bold text-[#004D40]">{title}</h4>
      <p className="text-[11px] text-slate-500">{desc}</p>
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
    <div className="bg-[#F8FBFA] min-h-screen flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-6xl bg-white rounded-[40px] shadow-[0_20px_50px_rgba(0,0,0,0.05)] overflow-hidden grid grid-cols-1 lg:grid-cols-2">

        {/* LEFT SIDE: Visuals & Benefits */}
        <div className="bg-[#E6F9F3] p-12 relative overflow-hidden flex flex-col justify-between">
          <div className="relative z-10">
            <span className="inline-block bg-white text-[#00D094] px-4 py-1 rounded-full text-[10px] font-bold tracking-widest mb-8 shadow-sm">
              WELCOME BACK
            </span>

            <h2 className="text-5xl font-extrabold leading-[1.1] mb-6">
              <span className="text-[#004D40]">Good to see</span> <br />
              <span className="text-[#00D094]">you again!</span>
            </h2>

            <p className="text-sm text-slate-500 max-w-sm mb-10 leading-relaxed">
              Log in to your Mansoorikart account to continue shopping, track orders, manage your wishlist, and more.
            </p>

            <div className="space-y-6">
              <BenefitItem
                icon={ShoppingBag}
                title="Track Your Orders"
                desc="Get real-time updates on your purchases"
              />
              <BenefitItem
                icon={Heart}
                title="Save Your Favorites"
                desc="Keep track of the products you love"
              />
              <BenefitItem
                icon={User}
                title="A Personalized Experience"
                desc="Get better recommendations"
              />
              <BenefitItem
                icon={Settings}
                title="Manage Your Account"
                desc="Update profile, addresses and preferences"
              />
            </div>
          </div>

          {/* Slogan and Visual Placeholder */}
          <div className="relative z-10 mt-12">
            <p className="font-serif italic text-3xl text-[#004D40] opacity-80 -rotate-3">
              Shop More <br /> Live Better
            </p>
          </div>

          {/* Visual Decor: In production, place your 3D asset image here */}
          <div className="absolute bottom-0 right-0 w-2/3 h-2/3 pointer-events-none select-none opacity-40 lg:opacity-100">
            <div className="absolute bottom-10 right-10 bg-gradient-to-tr from-[#00D094]/20 to-transparent w-64 h-64 rounded-full blur-3xl" />
            {/* <img src="/3d-shopping-assets.png" alt="decor" className="absolute bottom-0 right-0 object-contain" /> */}
          </div>
        </div>

        {/* RIGHT SIDE: Login Form */}
        <div className="p-10 lg:p-20 flex flex-col justify-center bg-white">
          <div className="max-w-md mx-auto w-full">
            <div className="mb-8">
              <h1 className="text-3xl font-extrabold text-[#004D40] tracking-tight">Login to your account</h1>
              <p className="text-sm text-slate-400 mt-2">Welcome back! Please enter your details to continue.</p>
            </div>

            {/* Social Logins */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              <button className="flex items-center justify-center gap-2 border border-slate-100 rounded-2xl py-3 px-4 text-xs font-bold hover:bg-slate-50 transition-all">
                <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-4 h-4" alt="Google" />
                Continue with Google
              </button>
              <button className="flex items-center justify-center gap-2 border border-slate-100 rounded-2xl py-3 px-4 text-xs font-bold hover:bg-slate-50 transition-all">
                <img src="https://www.svgrepo.com/show/303108/apple-black-logo.svg" className="w-4 h-4" alt="Apple" />
                Continue with Apple
              </button>
            </div>

            <div className="relative flex items-center mb-8">
              <div className="flex-grow border-t border-slate-100"></div>
              <span className="flex-shrink mx-4 text-[10px] font-bold text-slate-300 tracking-widest uppercase">OR</span>
              <div className="flex-grow border-t border-slate-100"></div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Email Address *</label>
                <div className="relative">
                  <Input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="bg-white border-slate-200 rounded-2xl py-6 pl-12 text-sm focus:border-[#00D094] transition-all"
                  />
                  <Mail className="w-5 h-5 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Password *</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="bg-white border-slate-200 rounded-2xl py-6 pl-12 pr-12 text-sm focus:border-[#00D094] transition-all"
                  />
                  <Lock className="w-5 h-5 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-[#00D094]"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs font-medium">
                <label className="flex items-center gap-2 cursor-pointer text-slate-500">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="rounded border-slate-300 text-[#00D094] focus:ring-[#00D094]"
                  />
                  Remember me
                </label>
                <Link href="/forgot-password" className="text-blue-500 font-bold hover:underline">
                  Forgot password?
                </Link>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#00D094] to-[#73E9C4] hover:opacity-90 text-white rounded-2xl py-6 font-bold text-sm shadow-xl shadow-emerald-100 flex items-center justify-center gap-2 border-none"
              >
                {loading ? 'Logging in...' : 'Login'} <ArrowRight className="w-4 h-4" />
              </Button>
            </form>

            <p className="text-center text-xs text-slate-400 mt-8">
              Don't have an account?{' '}
              <Link href="/register" className="font-bold text-blue-500 hover:underline">
                Create a new account
              </Link>
            </p>

            {/* Secure Badge */}
            <div className="mt-12 flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <div className="bg-[#00D094]/10 p-2 rounded-full text-[#00D094]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-[#004D40]">Secure Login</p>
                <p className="text-[10px] text-slate-400">Your information is encrypted and secure.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}