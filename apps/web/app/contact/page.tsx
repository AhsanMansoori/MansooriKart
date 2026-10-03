'use client';

import * as React from 'react';
import { MapPin, Phone, Mail, Clock, Send, CheckCircle2, Sparkles } from 'lucide-react';
import { Button, Input, Select } from '@mansoorikart/ui';

const INQUIRY_TYPES = [
  { value: 'order', label: 'Order Inquiry & Live Tracking' },
  { value: 'returns', label: 'Return & Exchange Assistance' },
  { value: 'product', label: 'Product Specifications & Advice' },
  { value: 'corporate', label: 'B2B & Bulk Corporate Orders' },
  { value: 'other', label: 'General Feedback & Support' },
];

export default function ContactPage() {
  const [formData, setFormData] = React.useState({
    name: '',
    email: '',
    phone: '',
    subject: 'order',
    orderId: '',
    message: '',
  });

  const [isSubmitted, setIsSubmitted] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
    setTimeout(() => {
      setFormData({
        name: '',
        email: '',
        phone: '',
        subject: 'order',
        orderId: '',
        message: '',
      });
    }, 500);
  };

  return (
    <div className="bg-surface-canvas min-h-screen py-10 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-mint/20 text-brand-mint-dark text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5" /> WE ARE HERE TO HELP
          </span>
          <h1 className="text-3xl sm:text-4xl font-black text-brand-navy tracking-tight">Contact Dubai Support</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Have questions about an order, tracking, or bulk enterprise purchases? Reach out to our dedicated Dubai concierge.
          </p>
        </div>

        {/* Contact Info Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-3">
            <div className="w-10 h-10 rounded-xl bg-surface-mint text-brand-teal flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Headquarters</span>
              <h3 className="text-sm font-bold text-brand-navy mt-1">Dubai Business Bay</h3>
              <p className="text-xs text-slate-500 mt-1">Tower 1, Level 14, Business Bay, Dubai, UAE</p>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-3">
            <div className="w-10 h-10 rounded-xl bg-surface-teal text-brand-teal flex items-center justify-center">
              <Phone className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Phone & WhatsApp</span>
              <h3 className="text-sm font-bold text-brand-navy mt-1">+971 4 123 4567</h3>
              <p className="text-xs text-slate-500 mt-1">WhatsApp: +971 50 123 4567</p>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Email Support</span>
              <h3 className="text-sm font-bold text-brand-navy mt-1">support@mansoorikart.ae</h3>
              <p className="text-xs text-slate-500 mt-1">Average response time under 15 minutes</p>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-3">
            <div className="w-10 h-10 rounded-xl bg-surface-mint text-brand-mint flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Operating Hours</span>
              <h3 className="text-sm font-bold text-brand-navy mt-1">Daily 8:00 AM - 10:00 PM</h3>
              <p className="text-xs text-slate-500 mt-1">Gulf Standard Time (GST)</p>
            </div>
          </div>
        </div>

        {/* Message Form & Map Column */}
        <div className="bg-white rounded-3xl p-8 sm:p-12 border border-slate-100 shadow-sm max-w-3xl mx-auto">
          {isSubmitted ? (
            <div className="py-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-surface-mint text-brand-mint mx-auto flex items-center justify-center shadow-xs">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-black text-brand-navy">Message Received!</h2>
              <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                Thank you for contacting MansooriKart UAE. A customer support specialist will review your inquiry and respond to your email shortly.
              </p>
              <Button variant="outline" size="md" onClick={() => setIsSubmitted(false)} className="rounded-full px-6 text-xs font-bold mt-2">
                Send Another Message
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <h2 className="text-xl font-black text-brand-navy">Send us a Message</h2>
                <p className="text-xs text-slate-500 mt-0.5">Fill out the form below and we will get back to you promptly.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Full Name</label>
                  <Input
                    type="text"
                    required
                    placeholder="Ahmed Mansoori"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Email Address</label>
                  <Input
                    type="email"
                    required
                    placeholder="ahmed@example.ae"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">UAE Mobile Number</label>
                  <Input
                    type="tel"
                    placeholder="+971 50 123 4567"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Order Reference # (Optional)</label>
                  <Input
                    type="text"
                    placeholder="e.g. MK-89421"
                    value={formData.orderId}
                    onChange={e => setFormData({ ...formData, orderId: e.target.value })}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Inquiry Type</label>
                <Select
                  options={INQUIRY_TYPES}
                  value={formData.subject}
                  onChange={e => setFormData({ ...formData, subject: e.target.value })}
                  className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Your Message</label>
                <textarea
                  required
                  rows={4}
                  placeholder="How can our Dubai team assist you today?"
                  value={formData.message}
                  onChange={e => setFormData({ ...formData, message: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 text-xs rounded-xl focus:border-brand-teal focus:ring-1 focus:ring-brand-teal outline-hidden"
                />
              </div>

              <Button type="submit" variant="primary" size="lg" className="w-full rounded-2xl font-bold text-sm shadow-md shadow-brand-mint/20 gap-2">
                <Send className="w-4 h-4" /> Send Inquiry
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
