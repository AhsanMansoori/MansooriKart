import express from 'express';
import { z } from 'zod';
import { createAddress, deleteAddress, getCurrentUser, listAddresses, updateAddress, updateProfile } from '../../../controllers/storefront/meController.js';
import { requireAuth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';

const router = express.Router();

const profile = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(1).max(30).optional(),
    avatar: z.string().url().max(2048).optional(),
  })
  .strict();

const address = z
  .object({
    label: z.string().trim().min(1).max(50).optional(),
    fullName: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(1).max(30),
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    stateProvince: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(30).optional(),
    country: z.string().trim().min(1).max(100),
    isDefault: z.boolean().optional(),
  })
  .strict();

const partialAddress = address.partial().refine(value => Object.keys(value).length > 0, 'At least one address field is required');

router.use(requireAuth);
router.get('/', getCurrentUser);
router.patch('/', validate(profile), updateProfile);
router.get('/addresses', listAddresses);
router.post('/addresses', validate(address), createAddress);
router.patch('/addresses/:id', validate(partialAddress), updateAddress);
router.delete('/addresses/:id', deleteAddress);

export default router;
