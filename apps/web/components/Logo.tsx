'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';

export interface LogoProps {
  /** Visual variant: default (light backgrounds) or dark (dark backgrounds like footer) */
  variant?: 'default' | 'dark' | 'iconOnly';
  /** Size preset */
  size?: 'sm' | 'md' | 'lg';
  /** Optional link override (defaults to '/') */
  href?: string;
  /** Whether to show the "Shop More · Live Better" tagline */
  showTagline?: boolean;
  className?: string;
}

export function Logo({ variant = 'default', size = 'md', href = '/', showTagline = true, className = '' }: LogoProps) {
  const sizeMap = {
    sm: { height: 28, width: 144, imgH: 'h-7', text: 'text-lg', sub: 'text-[8px]' },
    md: { height: 36, width: 185, imgH: 'h-9', text: 'text-xl', sub: 'text-[9px]' },
    lg: { height: 44, width: 226, imgH: 'h-11', text: 'text-2xl', sub: 'text-[10px]' },
  };

  const currentSize = sizeMap[size];

  // If icon-only is requested
  if (variant === 'iconOnly') {
    const content = (
      <div className={`relative aspect-square ${currentSize.imgH} flex items-center justify-center ${className}`}>
        <Image src="/logo-mark.png" alt="MansooriKart" width={40} height={40} className="object-contain w-auto h-full" priority />
      </div>
    );
    return href ? (
      <Link href={href} aria-label="MansooriKart Home">
        {content}
      </Link>
    ) : (
      content
    );
  }

  // If dark background (e.g. Footer)
  if (variant === 'dark') {
    const content = (
      <div className={`flex items-center gap-2.5 select-none ${className}`}>
        {/* MK Monogram SVG */}
        <div className="relative h-9 w-9 shrink-0 flex items-center justify-center">
          <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Speed lines */}
            <rect x="0" y="44" width="30" height="9" rx="4.5" fill="#18C19F" />
            <rect x="0" y="60" width="22" height="9" rx="4.5" fill="#18C19F" />
            <rect x="10" y="76" width="18" height="9" rx="4.5" fill="#18C19F" />
            {/* M leg left */}
            <path
              d="M38 20C38 14.4772 42.4772 10 48 10C53.5228 10 58 14.4772 58 20V92C58 97.5228 53.5228 102 48 102C42.4772 102 38 97.5228 38 92V20Z"
              fill="url(#tealGrad)"
            />
            {/* Center chevron */}
            <path
              d="M48 55L72 25C75.5 20.5 82.5 21 85.5 26C88.5 31 87.5 38 83 42L68 60L83 80C87.5 86 85 94 79 97C73 100 66 97 62 91L48 70"
              fill="url(#tealGrad)"
            />
            {/* K right arm / Cart basket */}
            <path d="M82 25L108 45C112 48 110 55 105 55H70" stroke="#FFCE00" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {/* K right leg */}
            <path d="M72 65L98 96C102 101 100 108 94 110C88 112 82 108 78 102L60 76" fill="url(#tealGrad)" />
            {/* Cart Wheel */}
            <circle cx="94" cy="80" r="8" fill="#FFCE00" />
            <defs>
              <linearGradient id="tealGrad" x1="38" y1="10" x2="98" y2="110" gradientUnits="userSpaceOnUse">
                <stop stopColor="#18C19F" />
                <stop offset="1" stopColor="#8BF3AF" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Text wordmark */}
        <div className="flex flex-col">
          <span className={`${currentSize.text} font-black tracking-tight text-white leading-none`}>
            MANSOORI<span className="text-[#FFCE00]">KART</span>
          </span>
          {showTagline && <span className={`${currentSize.sub} font-semibold uppercase tracking-widest text-[#18C19F] mt-1`}>Shop More · Live Better</span>}
        </div>
      </div>
    );
    return href ? (
      <Link href={href} aria-label="MansooriKart Home">
        {content}
      </Link>
    ) : (
      content
    );
  }

  // Default light background
  const content = (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      <div className={`relative ${currentSize.imgH} flex items-center`}>
        <Image
          src="/logo.png"
          alt="MansooriKart - Shop More Live Better"
          width={currentSize.width}
          height={currentSize.height}
          className="object-contain w-auto h-full"
          priority
        />
      </div>
    </div>
  );

  return href ? (
    <Link href={href} aria-label="MansooriKart Home" className="transition-opacity hover:opacity-90 shrink-0">
      {content}
    </Link>
  ) : (
    content
  );
}
