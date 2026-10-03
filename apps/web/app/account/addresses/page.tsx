'use client';

import * as React from 'react';
import { Plus, Trash2, CheckCircle2, Phone, Home, Briefcase, X } from 'lucide-react';
import { Button, Input, Select, Badge } from '@mansoorikart/ui';
import { useAuth } from '../../../components/providers';

const UAE_EMIRATES = [
  { value: 'Dubai', label: 'Dubai' },
  { value: 'Abu Dhabi', label: 'Abu Dhabi' },
  { value: 'Sharjah', label: 'Sharjah' },
  { value: 'Ajman', label: 'Ajman' },
  { value: 'Ras Al Khaimah', label: 'Ras Al Khaimah' },
  { value: 'Fujairah', label: 'Fujairah' },
  { value: 'Umm Al Quwain', label: 'Umm Al Quwain' },
];

export default function AddressesPage() {
  const { user, addAddress, deleteAddress, setDefaultAddress } = useAuth();

  const [modalOpen, setModalOpen] = React.useState(false);
  const [formData, setFormData] = React.useState({
    label: 'Home',
    fullName: user?.name || '',
    phone: user?.phone || '+971 50 123 4567',
    street: '',
    building: '',
    emirate: 'Dubai',
    city: 'Dubai',
    isDefault: false,
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    addAddress(formData);
    setModalOpen(false);
    setFormData({
      label: 'Home',
      fullName: user?.name || '',
      phone: user?.phone || '+971 50 123 4567',
      street: '',
      building: '',
      emirate: 'Dubai',
      city: 'Dubai',
      isDefault: false,
    });
  };

  const addresses = user?.addresses || [];

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-brand-navy tracking-tight">Saved Addresses</h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage delivery addresses for fast 1-click UAE checkout</p>
        </div>

        <Button variant="primary" size="sm" onClick={() => setModalOpen(true)} className="rounded-xl text-xs font-bold gap-1.5 shadow-sm">
          <Plus className="w-4 h-4" /> Add New Address
        </Button>
      </div>

      {/* Address Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {addresses.map(addr => (
          <div
            key={addr.id}
            className={`p-6 rounded-3xl border-2 transition-all flex flex-col justify-between space-y-4 ${
              addr.isDefault ? 'border-brand-teal bg-surface-teal/20 shadow-xs' : 'border-slate-100 bg-surface-canvas hover:border-slate-200'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="flex items-center gap-1.5 text-xs font-black text-brand-navy">
                  {addr.label === 'Home' ? <Home className="w-4 h-4 text-brand-teal" /> : <Briefcase className="w-4 h-4 text-brand-navy" />}
                  {addr.label.toUpperCase()}
                </span>
                {addr.isDefault && (
                  <Badge variant="teal" size="sm">
                    DEFAULT
                  </Badge>
                )}
              </div>

              <div className="space-y-1 text-xs text-slate-600">
                <p className="font-bold text-brand-navy text-sm">{addr.fullName}</p>
                <p>{addr.street}</p>
                <p>
                  {addr.building}, {addr.city}
                </p>
                <p className="font-medium text-slate-700">{addr.emirate}, United Arab Emirates</p>
                <p className="text-slate-400 pt-2 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> {addr.phone}
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200/60 flex items-center justify-between">
              {!addr.isDefault ? (
                <button type="button" onClick={() => setDefaultAddress(addr.id)} className="text-xs font-bold text-brand-teal hover:underline cursor-pointer">
                  Set as Default
                </button>
              ) : (
                <span className="text-[11px] font-bold text-brand-mint-dark flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-mint" /> Primary Address
                </span>
              )}

              <button
                type="button"
                onClick={() => deleteAddress(addr.id)}
                className="text-slate-400 hover:text-brand-red p-1 rounded-md transition-colors cursor-pointer"
                title="Delete address"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Address Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-navy/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-lg font-black text-brand-navy">Add New UAE Address</h2>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Address Label</label>
                <div className="flex gap-3">
                  {['Home', 'Office', 'Other'].map(lbl => (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() => setFormData({ ...formData, label: lbl })}
                      className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                        formData.label === lbl ? 'border-brand-teal bg-surface-mint text-brand-teal' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Full Name</label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. Ahmed Mansoori"
                    value={formData.fullName}
                    onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Phone Number</label>
                  <Input
                    type="tel"
                    required
                    placeholder="+971 50 123 4567"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Emirate</label>
                  <Select
                    options={UAE_EMIRATES}
                    value={formData.emirate}
                    onChange={e => setFormData({ ...formData, emirate: e.target.value })}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">City / Area</label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. Jumeirah 1 / Downtown"
                    value={formData.city}
                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Street Address</label>
                <Input
                  type="text"
                  required
                  placeholder="Street name, landmark"
                  value={formData.street}
                  onChange={e => setFormData({ ...formData, street: e.target.value })}
                  className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Building, Villa or Flat #</label>
                <Input
                  type="text"
                  required
                  placeholder="e.g. Villa 42 / Level 14 Flat 1402"
                  value={formData.building}
                  onChange={e => setFormData({ ...formData, building: e.target.value })}
                  className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="makeDefault"
                  checked={formData.isDefault}
                  onChange={e => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="rounded-sm border-slate-300 text-brand-teal focus:ring-brand-teal"
                />
                <label htmlFor="makeDefault" className="text-xs text-slate-600 font-semibold cursor-pointer">
                  Make this my default shipping address
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <Button type="button" variant="outline" size="md" onClick={() => setModalOpen(false)} className="rounded-xl text-xs font-bold border-slate-200">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="md" className="rounded-xl text-xs font-bold shadow-sm">
                  Save Address
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
