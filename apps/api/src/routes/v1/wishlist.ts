import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from '../../controllers/wishlistController.js';

const router = express.Router();
const item = z.object({ productId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();

router.use(requireAuth);

router.get('/', controller.get);

router.post('/items', validate(item), controller.add);

router.delete('/items/:productId', controller.remove);

router.delete('/', controller.clear);

export default router;
