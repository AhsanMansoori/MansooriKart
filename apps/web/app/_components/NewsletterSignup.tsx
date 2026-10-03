'use client';

import * as React from 'react';
import { Send, CheckCircle2 } from 'lucide-react';
import { Button, Input } from '@mansoorikart/ui';

export function NewsletterSignup() {
  const [email, setEmail] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubmitted(true);
      setEmail('');
    }
  };

  if (submitted) {
    return (
      <div className="p-3.5 rounded-2xl bg-white/10 border border-brand-mint/40 text-brand-mint-light text-xs font-semibold flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-brand-mint shrink-0" />
        <span>Thank you for joining! Check your inbox for your welcome discount.</span>
      </div>
    );
  }

  return (
    <form className="flex flex-col sm:flex-row gap-2 max-w-md pt-2" onSubmit={handleSubmit}>
      <Input
        type="email"
        placeholder="Enter your email address"
        value={email}
        onChange={e => setEmail(e.target.value)}
        required
        className="bg-slate-900/90 border-slate-700 text-white placeholder:text-slate-500 rounded-full"
      />
      <Button variant="primary" size="md" type="submit" className="rounded-full px-6 gap-2 text-xs font-bold shrink-0">
        <Send className="w-3.5 h-3.5" /> Subscribe
      </Button>
    </form>
  );
}
