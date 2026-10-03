'use client';

import * as React from 'react';
import Image from 'next/image';
import { Heart, ChevronLeft, ChevronRight, RotateCw, Play } from 'lucide-react';
import { Badge } from '@mansoorikart/ui';

interface GalleryImage {
  url: string;
  alt?: string;
}

interface ProductGalleryProps {
  images: GalleryImage[];
  title: string;
  badge?: string;
  isWishlisted?: boolean;
  onToggleWishlist?: () => void;
}

export function ProductGallery({ images, title, badge, isWishlisted = false, onToggleWishlist }: ProductGalleryProps) {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [is360Active, setIs360Active] = React.useState(false);

  const displayImages =
    images.length > 0 ? images : [{ url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80', alt: title }];
  const currentImage = displayImages[selectedIndex] || displayImages[0];

  const handlePrev = () => {
    setSelectedIndex(prev => (prev === 0 ? displayImages.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setSelectedIndex(prev => (prev === displayImages.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className="flex flex-col-reverse md:flex-row gap-4 items-start">
      {/* Vertical Thumbnail Rail */}
      <div className="flex md:flex-col gap-2.5 overflow-x-auto md:overflow-y-auto max-h-[500px] w-full md:w-20 shrink-0 py-1">
        {displayImages.map((img, idx) => {
          const isSelected = idx === selectedIndex;
          const isVideo = idx === 4; // 5th item demo video
          return (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setSelectedIndex(idx);
                setIs360Active(false);
              }}
              className={`relative w-16 h-16 md:w-20 md:h-20 rounded-2xl overflow-hidden bg-slate-50 border-2 transition-all shrink-0 ${
                isSelected ? 'border-brand-teal ring-2 ring-brand-teal/20 shadow-xs' : 'border-slate-200/80 hover:border-slate-300'
              }`}
            >
              <Image src={img.url} alt={img.alt || `${title} thumbnail ${idx + 1}`} fill className="object-cover" sizes="80px" />
              {isVideo && (
                <div className="absolute inset-0 bg-brand-navy/30 flex items-center justify-center text-white">
                  <Play className="w-4 h-4 fill-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Image Showcase Container */}
      <div className="relative w-full aspect-square rounded-3xl bg-slate-50/80 border border-slate-100 flex items-center justify-center overflow-hidden p-6 sm:p-10 shadow-[0_10px_30px_-5px_rgba(11,25,44,0.03)]">
        {/* Discount Badge */}
        {badge && (
          <div className="absolute top-4 left-4 z-10">
            <Badge variant="discount" size="md">
              {badge}
            </Badge>
          </div>
        )}

        {/* Wishlist Heart */}
        <button
          type="button"
          onClick={onToggleWishlist}
          aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          className={`absolute top-4 right-4 z-10 w-10 h-10 rounded-full flex items-center justify-center transition-all bg-white shadow-sm hover:scale-110 active:scale-95 ${
            isWishlisted ? 'text-brand-red bg-white shadow-md' : 'text-slate-400 hover:text-brand-red'
          }`}
        >
          <Heart className={`w-5 h-5 ${isWishlisted ? 'fill-brand-red stroke-brand-red' : ''}`} />
        </button>

        {/* Previous Arrow */}
        {displayImages.length > 1 && (
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous image"
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/90 shadow-sm border border-slate-100 flex items-center justify-center text-slate-600 hover:text-brand-navy hover:bg-white transition-all"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* Next Arrow */}
        {displayImages.length > 1 && (
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next image"
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/90 shadow-sm border border-slate-100 flex items-center justify-center text-slate-600 hover:text-brand-navy hover:bg-white transition-all"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}

        {/* Main Image */}
        <div className={`relative w-full h-full transition-transform duration-500 ${is360Active ? 'rotate-12 scale-105' : ''}`}>
          <Image
            src={currentImage.url}
            alt={currentImage.alt || title}
            fill
            priority
            className="object-contain object-center drop-shadow-xl"
            sizes="(max-width: 768px) 100vw, 45vw"
          />
        </div>

        {/* 360 View Badge Button */}
        <button
          type="button"
          onClick={() => setIs360Active(!is360Active)}
          className={`absolute bottom-4 right-4 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm ${
            is360Active ? 'bg-brand-teal text-white shadow-md' : 'bg-white/90 border border-slate-200 text-brand-navy hover:bg-white'
          }`}
        >
          <RotateCw className={`w-3.5 h-3.5 ${is360Active ? 'animate-spin' : ''}`} />
          360° View
        </button>

        {/* Bottom Indicator Dots */}
        {displayImages.length > 1 && (
          <div className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-1.5 z-10 pointer-events-none">
            {displayImages.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === selectedIndex ? 'w-5 bg-brand-teal' : 'bg-slate-300'}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
