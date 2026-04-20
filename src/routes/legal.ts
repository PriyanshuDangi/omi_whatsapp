/**
 * Legal routes — serve the static Privacy Policy, Terms of Service, and Disclaimer pages.
 *
 * GET /legal             → redirect to the Privacy Policy
 * GET /legal/privacy     → Privacy Policy
 * GET /legal/terms       → Terms of Service
 * GET /legal/disclaimer  → Non-affiliation disclaimer & trademark notice
 */

import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.resolve(__dirname, '..', 'views', 'legal');

export const legalRouter = Router();

legalRouter.get('/', (_req, res) => {
  res.redirect('/legal/privacy');
});

legalRouter.get('/privacy', (_req, res) => {
  res.sendFile(path.join(viewsDir, 'privacy.html'));
});

legalRouter.get('/terms', (_req, res) => {
  res.sendFile(path.join(viewsDir, 'terms.html'));
});

legalRouter.get('/disclaimer', (_req, res) => {
  res.sendFile(path.join(viewsDir, 'disclaimer.html'));
});
