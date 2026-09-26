import { Schema, model, models, type Model } from 'mongoose';
import {
  CURRENCY_DISPLAYS,
  DEFAULT_CURRENCY,
  DEFAULT_CURRENCY_DISPLAY,
  DEFAULT_LOCALE,
  DEFAULT_ROBOTS,
  DEFAULT_TIMEZONE,
  EMAIL_DEFAULTS,
  INVOICE_DEFAULTS,
  MAINTENANCE_DEFAULT_MESSAGE,
  ROBOTS_DIRECTIVES,
  SHIPPING_DEFAULTS,
  SOCIAL_CHANNELS,
  STORE_DEFAULTS,
  SUPPORTED_LOCALES,
  TAX_DEFAULTS,
} from '../config/storefront.js';

/**
 * The single store-configuration authority.
 *
 * One document, keyed `STORE`, holds every operator-editable store setting as a
 * typed sub-document: identity, contact, social, SEO, shipping, tax, invoice,
 * email behaviour and maintenance. It is deliberately not a `key/value: Mixed`
 * bag — each field is declared, enumerated and bounded here, so a settings write
 * cannot introduce an unknown key and a reader never has to guess a type.
 *
 * **No credential is ever stored in this document.** There is no SMTP host, no
 * password and no provider API key field; runtime secrets stay in the deployment
 * environment. See `docs/STORE_CONFIGURATION_ARCHITECTURE.md`.
 */
const contactSchema = new Schema(
  {
    supportEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
    supportPhone: { type: String, trim: true, maxlength: 40 },
    businessEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
    businessPhone: { type: String, trim: true, maxlength: 40 },
    whatsapp: { type: String, trim: true, maxlength: 40 },
    addressLine1: { type: String, trim: true, maxlength: 200 },
    addressLine2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, maxlength: 120 },
    stateProvince: { type: String, trim: true, maxlength: 120 },
    postalCode: { type: String, trim: true, maxlength: 30 },
    country: { type: String, trim: true, maxlength: 120, default: 'Pakistan' },
    supportHours: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false }
);

const socialLinkSchema = new Schema(
  {
    channel: { type: String, enum: SOCIAL_CHANNELS as string[], required: true },
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const seoSchema = new Schema(
  {
    metaTitle: { type: String, trim: true, maxlength: 200 },
    metaDescription: { type: String, trim: true, maxlength: 300 },
    metaKeywords: { type: [String], default: [] },
    canonicalUrl: { type: String, trim: true, maxlength: 2048 },
    robots: { type: String, enum: ROBOTS_DIRECTIVES as string[], default: DEFAULT_ROBOTS },
    socialImageUrl: { type: String, trim: true, maxlength: 2048 },
    openGraphTitle: { type: String, trim: true, maxlength: 200 },
    openGraphDescription: { type: String, trim: true, maxlength: 300 },
    twitterHandle: { type: String, trim: true, maxlength: 60 },
  },
  { _id: false }
);

/** Optional per-city delivery fee override. Bounded by `SHIPPING_DEFAULTS.maxCityOverrides`. */
const cityFeeSchema = new Schema(
  { city: { type: String, required: true, trim: true, maxlength: 120 }, fee: { type: Number, required: true, min: 0, max: SHIPPING_DEFAULTS.maxFee } },
  { _id: false }
);

const shippingSchema = new Schema(
  {
    enabled: { type: Boolean, default: SHIPPING_DEFAULTS.enabled },
    standardFee: { type: Number, default: SHIPPING_DEFAULTS.standardFee, min: 0, max: SHIPPING_DEFAULTS.maxFee },
    freeShippingEnabled: { type: Boolean, default: SHIPPING_DEFAULTS.freeShippingEnabled },
    freeShippingThreshold: { type: Number, default: SHIPPING_DEFAULTS.freeShippingThreshold, min: 0, max: SHIPPING_DEFAULTS.maxThreshold },
    codEnabled: { type: Boolean, default: SHIPPING_DEFAULTS.codEnabled },
    cityOverrides: { type: [cityFeeSchema], default: [] },
    deliveryEstimate: { type: String, trim: true, maxlength: 200 },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  { _id: false }
);

const taxSchema = new Schema(
  {
    enabled: { type: Boolean, default: TAX_DEFAULTS.enabled },
    defaultRate: { type: Number, default: TAX_DEFAULTS.defaultRate, min: 0, max: TAX_DEFAULTS.maxRate },
    pricesIncludeTax: { type: Boolean, default: TAX_DEFAULTS.pricesIncludeTax },
    displayTaxSeparately: { type: Boolean, default: TAX_DEFAULTS.displayTaxSeparately },
    label: { type: String, trim: true, maxlength: 40, default: TAX_DEFAULTS.label },
    taxNumber: { type: String, trim: true, maxlength: 60 },
  },
  { _id: false }
);

const invoiceSchema = new Schema(
  {
    showLogo: { type: Boolean, default: INVOICE_DEFAULTS.showLogo },
    showTaxNumber: { type: Boolean, default: INVOICE_DEFAULTS.showTaxNumber },
    footerNote: { type: String, trim: true, maxlength: 2000, default: INVOICE_DEFAULTS.footerNote },
    termsNote: { type: String, trim: true, maxlength: 2000, default: INVOICE_DEFAULTS.termsNote },
    contactLine: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false }
);

/** Email *behaviour*, not email transport. No host, port, username or password field exists. */
const emailSchema = new Schema(
  {
    fromName: { type: String, trim: true, maxlength: 120, default: EMAIL_DEFAULTS.fromName },
    replyTo: { type: String, trim: true, lowercase: true, maxlength: 200 },
    supportEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
    brandingHeadline: { type: String, trim: true, maxlength: 200 },
    brandingFooter: { type: String, trim: true, maxlength: 500 },
    orderConfirmationEnabled: { type: Boolean, default: EMAIL_DEFAULTS.orderConfirmationEnabled },
    shippingUpdateEnabled: { type: Boolean, default: EMAIL_DEFAULTS.shippingUpdateEnabled },
    deliveryEmailEnabled: { type: Boolean, default: EMAIL_DEFAULTS.deliveryEmailEnabled },
    includeInvoiceLink: { type: Boolean, default: EMAIL_DEFAULTS.includeInvoiceLink },
  },
  { _id: false }
);

const storeConfigurationSchema = new Schema(
  {
    /** Fixed discriminator. The unique index on it is what makes the document a singleton. */
    key: { type: String, required: true, unique: true, default: 'STORE', enum: ['STORE'] },
    storeName: { type: String, trim: true, maxlength: 160, default: 'MansooriKart' },
    legalName: { type: String, trim: true, maxlength: 200 },
    tagline: { type: String, trim: true, maxlength: 300 },
    logoUrl: { type: String, trim: true, maxlength: 2048 },
    faviconUrl: { type: String, trim: true, maxlength: 2048 },
    defaultCurrency: { type: String, uppercase: true, maxlength: 3, default: DEFAULT_CURRENCY },
    currencyDisplay: { type: String, enum: CURRENCY_DISPLAYS as string[], default: DEFAULT_CURRENCY_DISPLAY },
    timezone: { type: String, trim: true, maxlength: 60, default: DEFAULT_TIMEZONE },
    defaultLocale: { type: String, enum: SUPPORTED_LOCALES as string[], default: DEFAULT_LOCALE },
    orderPrefix: { type: String, trim: true, uppercase: true, maxlength: 8, default: STORE_DEFAULTS.orderPrefix },
    lowStockThreshold: { type: Number, min: 0, max: STORE_DEFAULTS.maxLowStockThreshold, default: STORE_DEFAULTS.lowStockThreshold },
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, trim: true, maxlength: 500, default: MAINTENANCE_DEFAULT_MESSAGE },
    contact: { type: contactSchema, default: () => ({}) },
    socialLinks: { type: [socialLinkSchema], default: [] },
    seo: { type: seoSchema, default: () => ({}) },
    shipping: { type: shippingSchema, default: () => ({}) },
    tax: { type: taxSchema, default: () => ({}) },
    invoice: { type: invoiceSchema, default: () => ({}) },
    email: { type: emailSchema, default: () => ({}) },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'storeconfigurations', minimize: false }
);

export const StoreConfiguration: any = (models.StoreConfiguration as Model<any>) || model('StoreConfiguration', storeConfigurationSchema);
