'use client';

import * as React from 'react';
import { Lock, Bell, CheckCircle2, Save } from 'lucide-react';
import { Button, Input } from '@mansoorikart/ui';
import { useAuth } from '../../../components/providers';

export default function AccountSettingsPage() {
  const { user, updateUser } = useAuth();

  const [name, setName] = React.useState(user?.name || 'Ahmed Mansoori');
  const [email, setEmail] = React.useState(user?.email || 'ahmed.mansoori@mansoorikart.ae');
  const [phone, setPhone] = React.useState(user?.phone || '+971 50 123 4567');

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  const [emailNotifications, setEmailNotifications] = React.useState(true);
  const [smsNotifications, setSmsNotifications] = React.useState(true);

  const [profileSuccess, setProfileSuccess] = React.useState('');
  const [passwordSuccess, setPasswordSuccess] = React.useState('');
  const [passwordError, setPasswordError] = React.useState('');

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateUser({ name, email, phone });
    setProfileSuccess('Profile information updated successfully!');
    setTimeout(() => setProfileSuccess(''), 3000);
  };

  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setPasswordSuccess('Password changed successfully!');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => setPasswordSuccess(''), 3000);
  };

  return (
    <div className="space-y-8">
      {/* 1. Personal Information */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-brand-navy tracking-tight">Account Settings</h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage your personal profile, credentials, and notification preferences</p>
        </div>

        {profileSuccess && (
          <div className="p-3.5 rounded-2xl bg-surface-mint border border-border-mint text-brand-mint-dark text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-brand-mint" />
            <span>{profileSuccess}</span>
          </div>
        )}

        <form onSubmit={handleUpdateProfile} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Full Name</label>
              <Input type="text" required value={name} onChange={e => setName(e.target.value)} className="bg-slate-50 border-slate-200 text-xs rounded-xl" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Email Address</label>
              <Input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="bg-slate-50 border-slate-200 text-xs rounded-xl" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">UAE Mobile Number</label>
            <Input
              type="tel"
              required
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="bg-slate-50 border-slate-200 text-xs rounded-xl max-w-sm"
            />
          </div>

          <div className="pt-2">
            <Button type="submit" variant="primary" size="md" className="rounded-xl text-xs font-bold gap-2 shadow-xs">
              <Save className="w-3.5 h-3.5" /> Save Profile Changes
            </Button>
          </div>
        </form>
      </div>

      {/* 2. Security & Change Password */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-6">
        <div>
          <h2 className="text-base font-black text-brand-navy flex items-center gap-2">
            <Lock className="w-4 h-4 text-brand-teal" /> Change Password
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Ensure your account uses a long, random password for safety.</p>
        </div>

        {passwordSuccess && (
          <div className="p-3.5 rounded-2xl bg-surface-mint border border-border-mint text-brand-mint-dark text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-brand-mint" />
            <span>{passwordSuccess}</span>
          </div>
        )}

        {passwordError && <div className="p-3.5 rounded-2xl bg-brand-red-light text-brand-red-dark text-xs font-bold">{passwordError}</div>}

        <form onSubmit={handleUpdatePassword} className="space-y-4 max-w-lg">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Current Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="bg-slate-50 border-slate-200 text-xs rounded-xl"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">New Password</label>
              <Input
                type="password"
                placeholder="Min 6 characters"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="bg-slate-50 border-slate-200 text-xs rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Confirm New Password</label>
              <Input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="bg-slate-50 border-slate-200 text-xs rounded-xl"
              />
            </div>
          </div>

          <div className="pt-2">
            <Button type="submit" variant="secondary" size="md" className="rounded-xl text-xs font-bold shadow-xs">
              Update Password
            </Button>
          </div>
        </form>
      </div>

      {/* 3. Communication Preferences */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-6">
        <div>
          <h2 className="text-base font-black text-brand-navy flex items-center gap-2">
            <Bell className="w-4 h-4 text-brand-mint" /> Communication & Notification Preferences
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Control which updates you receive from MansooriKart UAE.</p>
        </div>

        <div className="space-y-4 max-w-lg">
          <label className="flex items-center justify-between p-4 rounded-2xl bg-surface-canvas border border-slate-100 cursor-pointer">
            <div>
              <span className="text-xs font-bold text-brand-navy block">Order Tracking SMS Updates</span>
              <span className="text-[11px] text-slate-500">Receive dispatch, courier telemetry, and delivery OTP via SMS.</span>
            </div>
            <input
              type="checkbox"
              checked={smsNotifications}
              onChange={e => setSmsNotifications(e.target.checked)}
              className="rounded-sm border-slate-300 text-brand-teal focus:ring-brand-teal w-4 h-4"
            />
          </label>

          <label className="flex items-center justify-between p-4 rounded-2xl bg-surface-canvas border border-slate-100 cursor-pointer">
            <div>
              <span className="text-xs font-bold text-brand-navy block">Exclusive Deals & Flash Sales</span>
              <span className="text-[11px] text-slate-500">Weekly tech drops, coupon codes, and UAE seasonal promotions.</span>
            </div>
            <input
              type="checkbox"
              checked={emailNotifications}
              onChange={e => setEmailNotifications(e.target.checked)}
              className="rounded-sm border-slate-300 text-brand-teal focus:ring-brand-teal w-4 h-4"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
