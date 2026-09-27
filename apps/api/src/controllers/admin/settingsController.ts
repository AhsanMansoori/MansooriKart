import type { NextFunction, Request, Response } from 'express';
import { AuditLog } from '../../models/auditLog.js';
import { adminStoreConfiguration } from '../../serializers/marketingAdmin.js';
import { getStoreConfiguration, updateStoreConfiguration } from '../../services/storeConfigService.js';
import { sendSuccess } from '../../utils/api-response.js';

const audit = (request: Request, action: string, metadata: Record<string, unknown>) =>
  AuditLog.create({ actor: request.auth!.userId, action, resourceType: 'StoreConfiguration', resourceId: 'STORE', requestId: request.requestId, metadata });

async function applySection(
  request: Request,
  response: Response,
  section: string | null,
  patch: Record<string, unknown>,
  action = 'SETTINGS_UPDATED',
  extra: Record<string, unknown> = {}
) {
  const current = await getStoreConfiguration();
  const scope: Record<string, any> = (section ? current?.[section] : current) ?? {};
  const fields = Object.keys(patch).filter(key => patch[key] !== undefined && JSON.stringify(scope[key] ?? null) !== JSON.stringify(patch[key] ?? null));
  if (!fields.length) return sendSuccess(response, adminStoreConfiguration(current));
  const updated = await updateStoreConfiguration(section, patch, request.auth!.userId);
  await audit(request, action, { section: section ?? 'store', fields, ...extra });
  return sendSuccess(response, adminStoreConfiguration(updated));
}

export const getSettings = async (_request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, adminStoreConfiguration(await getStoreConfiguration()));
  } catch (error) {
    return next(error);
  }
};

export const patchStoreSettings = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return await applySection(request, response, null, request.body);
  } catch (error) {
    return next(error);
  }
};

export const patchContactSettings = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return await applySection(request, response, 'contact', request.body);
  } catch (error) {
    return next(error);
  }
};

export const patchSocialSettings = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return await applySection(request, response, null, { socialLinks: request.body.links }, 'SETTINGS_UPDATED', { section: 'social' });
  } catch (error) {
    return next(error);
  }
};

export const patchSeoSettings = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return await applySection(request, response, 'seo', request.body);
  } catch (error) {
    return next(error);
  }
};

export const patchShippingSettings = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return await applySection(request, response, 'shipping', request.body);
  } catch (error) {
    return next(error);
  }
};

export const patchTaxSettings = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return await applySection(request, response, 'tax', request.body);
  } catch (error) {
    return next(error);
  }
};

export const patchInvoiceSettings = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return await applySection(request, response, 'invoice', request.body);
  } catch (error) {
    return next(error);
  }
};

export const patchEmailSettings = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return await applySection(request, response, 'email', request.body);
  } catch (error) {
    return next(error);
  }
};

export const patchMaintenanceSettings = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return await applySection(request, response, null, request.body, request.body.maintenanceMode ? 'MAINTENANCE_MODE_ENABLED' : 'MAINTENANCE_MODE_DISABLED', {
      section: 'maintenance',
    });
  } catch (error) {
    return next(error);
  }
};
