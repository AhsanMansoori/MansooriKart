'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Mail, User, Phone, ShoppingBag, ShieldCheck, Truck, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button, Input } from '@mansoorikart/ui';
import { useAuth } from '../../components/providers';

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('+971 ');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [agreeTerms, setAgreeTerms] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (!agreeTerms) {
      setError('Please accept the Terms & Conditions.');
      return;
    }

    setLoading(true);
    try {
      const ok = await register(name, email, phone, password);
      if (ok) {
        router.push('/account');
      } else {
        setError('Registration failed. Please try again.');
      }
    } catch {
      setError('An error occurred during registration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface-canvas min-h-[calc(100vh-140px)] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-4xl bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left Editorial Branding Banner */}
        <div className="lg:col-span-5 bg-brand-navy p-8 sm:p-10 text-white flex flex-col justify-between relative overflow-hidden">
          <div className="relative z-10 space-y-6">
            <Link href="/" className="inline-flex items-center gap-2">
              <div className="bg-white/10 rounded-xl px-2.5 py-1.5 backdrop-blur-xs flex items-center">
                <Image
                  src="/logo.svg"
                  alt="MansooriKart - Shop More Live Better"
                  width={160}
                  height={32}
                  className="h-7 w-auto object-contain brightness-0 invert"
                />
              </div>
            </Link>

            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-mint/20 text-brand-mint-light text-[10px] font-bold">
                <Sparkles className="w-3 h-3" /> JOIN MANSOORIKART
              </span>
              <h2 className="text-2xl font-black tracking-tight leading-snug">Create your account and unlock UAE member privileges</h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Enjoy personalized recommendations, express checkout, order telemetry, and AED 50 welcome reward.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2.5 text-xs text-slate-200">
                <ShieldCheck className="w-4 h-4 text-brand-mint shrink-0" />
                <span>100% Genuine UAE Verified Stock</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-slate-200">
                <Truck className="w-4 h-4 text-brand-teal shrink-0" />
                <span>Express Free Delivery over AED 150</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-slate-200">
                <CheckCircle2 className="w-4 h-4 text-brand-mint-light shrink-0" />
                <span>Exclusive UAE Tech Flash Sales</span>
              </div>
            </div>
          </div>

          <div className="relative z-10 pt-8 border-t border-slate-800 text-[11px] text-slate-400">MansooriKart LLC • Registered in Dubai, UAE</div>
        </div>

        {/* Right Form Card */}
        <div className="lg:col-span-7 p-8 sm:p-12 flex flex-col justify-center">
          <div className="max-w-md mx-auto w-full space-y-6">
            <div>
              <h1 className="text-2xl font-black text-brand-navy tracking-tight">Create Account</h1>
              <p className="text-xs text-slate-500 mt-1">Enter your details to create your MansooriKart UAE customer account.</p>
            </div>

            {error && <div className="p-3 rounded-xl bg-brand-red-light text-brand-red-dark text-xs font-semibold">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Full Name</label>
                <div className="relative">
                  <Input
                    type="text"
                    required
                    placeholder="Ahmed Mansoori"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl pr-10"
                  />
                  <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Email Address</label>
                <div className="relative">
                  <Input
                    type="email"
                    required
                    placeholder="ahmed@example.ae"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl pr-10"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">UAE Mobile Number</label>
                <div className="relative">
                  <Input
                    type="tel"
                    required
                    placeholder="+971 50 123 4567"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl pr-10"
                  />
                  <Phone className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Password</label>
                  <Input
                    type="password"
                    required
                    placeholder="Min 6 characters"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Confirm Password</label>
                  <Input
                    type="password"
                    required
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs pt-1">
                <input
                  type="checkbox"
                  id="agreeTerms"
                  checked={agreeTerms}
                  onChange={e => setAgreeTerms(e.target.checked)}
                  className="rounded-sm border-slate-300 text-brand-teal focus:ring-brand-teal"
                />
                <label htmlFor="agreeTerms" className="text-slate-600 cursor-pointer">
                  I agree to the <span className="text-brand-teal font-semibold">Terms of Service</span> and{' '}
                  <span className="text-brand-teal font-semibold">Privacy Policy</span>.
                </label>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={loading}
                className="w-full rounded-2xl font-bold text-sm shadow-md shadow-brand-mint/20 mt-2"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </Button>
            </form>

            <p className="text-center text-xs text-slate-500 pt-2">
              Already have an account?{' '}
              <Link href="/login" className="font-bold text-brand-teal hover:underline">
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
