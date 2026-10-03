'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, ArrowLeft, CheckCircle2, ShoppingBag } from 'lucide-react';
import { Button, Input } from '@mansoorikart/ui';

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [email, setEmail] = React.useState('');
  const [otp, setOtp] = React.useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [successMsg, setSuccessMsg] = React.useState('');

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep(2);
      setSuccessMsg(`We've sent a 6-digit security code to ${email}`);
    }, 600);
  };

  const handleOtpChange = (index: number, val: string) => {
    if (val.length > 1) val = val[val.length - 1];
    const nextOtp = [...otp];
    nextOtp[index] = val;
    setOtp(nextOtp);

    // auto focus next input
    if (val && index < 5) {
      const nextInput = document.getElementById(`otp-input-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleStep2Submit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) {
      setError('Please enter all 6 digits of your verification code.');
      return;
    }
    setError('');
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep(3);
    }, 600);
  };

  const handleStep3Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSuccessMsg('Your password has been successfully reset! Redirecting to login...');
      setTimeout(() => {
        router.push('/login');
      }, 1500);
    }, 600);
  };

  return (
    <div className="bg-surface-canvas min-h-[calc(100vh-140px)] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-xl p-8 sm:p-10 space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-teal to-brand-mint flex items-center justify-center text-white shadow-md">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <span className="text-xl font-extrabold tracking-tight text-brand-navy">
              Mansoori<span className="text-brand-teal">Kart</span>
            </span>
          </Link>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Password Recovery Journey</p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2">
          <span className={`w-8 h-1.5 rounded-full transition-all ${step >= 1 ? 'bg-brand-teal' : 'bg-slate-200'}`} />
          <span className={`w-8 h-1.5 rounded-full transition-all ${step >= 2 ? 'bg-brand-teal' : 'bg-slate-200'}`} />
          <span className={`w-8 h-1.5 rounded-full transition-all ${step >= 3 ? 'bg-brand-teal' : 'bg-slate-200'}`} />
        </div>

        {error && <div className="p-3 rounded-xl bg-brand-red-light text-brand-red-dark text-xs font-semibold text-center">{error}</div>}

        {successMsg && (
          <div className="p-3 rounded-xl bg-surface-mint border border-border-mint text-brand-mint-dark text-xs font-semibold text-center flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* STEP 1: Enter Email */}
        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="space-y-4">
            <div>
              <h1 className="text-xl font-black text-brand-navy">Forgot your password?</h1>
              <p className="text-xs text-slate-500 mt-1">
                Enter the email address associated with your MansooriKart account and we will send you a verification code.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Email Address</label>
              <div className="relative">
                <Input
                  type="email"
                  required
                  placeholder="name@example.ae"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="bg-slate-50 border-slate-200 text-xs rounded-xl pr-10"
                />
                <Mail className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={loading}
              className="w-full rounded-2xl font-bold text-sm shadow-md shadow-brand-mint/20 mt-2"
            >
              {loading ? 'Sending Code...' : 'Send Verification Code'}
            </Button>
          </form>
        )}

        {/* STEP 2: Enter 6-digit OTP */}
        {step === 2 && (
          <form onSubmit={handleStep2Submit} className="space-y-4">
            <div>
              <h1 className="text-xl font-black text-brand-navy">Enter Verification Code</h1>
              <p className="text-xs text-slate-500 mt-1">
                We sent a 6-digit code to <strong className="text-brand-navy">{email}</strong>. Enter the digits below:
              </p>
            </div>

            <div className="flex justify-between gap-2 pt-2">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  id={`otp-input-${i}`}
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  className="w-11 h-12 text-center text-lg font-black text-brand-navy bg-slate-50 border border-slate-200 rounded-xl focus:border-brand-teal focus:ring-1 focus:ring-brand-teal outline-hidden"
                />
              ))}
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={loading}
              className="w-full rounded-2xl font-bold text-sm shadow-md shadow-brand-mint/20 mt-4"
            >
              {loading ? 'Verifying...' : 'Verify Code & Proceed'}
            </Button>

            <button type="button" onClick={() => setStep(1)} className="w-full text-center text-xs font-bold text-slate-500 hover:text-brand-teal mt-2">
              Didn&apos;t get a code? Try another email
            </button>
          </form>
        )}

        {/* STEP 3: Set New Password */}
        {step === 3 && (
          <form onSubmit={handleStep3Submit} className="space-y-4">
            <div>
              <h1 className="text-xl font-black text-brand-navy">Set New Password</h1>
              <p className="text-xs text-slate-500 mt-1">Create a strong new password for your MansooriKart account.</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">New Password</label>
              <Input
                type="password"
                required
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="bg-slate-50 border-slate-200 text-xs rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Confirm New Password</label>
              <Input
                type="password"
                required
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="bg-slate-50 border-slate-200 text-xs rounded-xl"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={loading}
              className="w-full rounded-2xl font-bold text-sm shadow-md shadow-brand-mint/20 mt-2"
            >
              {loading ? 'Updating Password...' : 'Save New Password'}
            </Button>
          </form>
        )}

        <div className="pt-2 text-center border-t border-slate-100">
          <Link href="/login" className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-brand-teal transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
