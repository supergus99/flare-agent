/**
 * Flare Worker: fetch router + queue consumer (flare-jobs).
 * Bindings: DB (D1), REPORTS (R2), JOBS (Queue).
 * Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, OPENAI_API_KEY (optional),
 *          WORKER_PUBLIC_URL, SUCCESS_BASE_URL, FLARE_BASE_URL, FLARE_FROM_EMAIL, ADMIN_SECRET (optional).
 */

import { handleStripeWebhook } from './handlers/stripe-webhook.js';
import { handleQueueBatch } from './handlers/queue-consumer.js';
import {
  handleAssessmentGate,
  handleAssessmentsPost,
  handleAssessmentTemplateGet,
} from './handlers/assessment.js';
import { handleReportView, handleReportApprove } from './handlers/report.js';
import {
  requireAdmin,
  handleAdminReports,
  handleAdminPayments,
  handleAdminSubmissions,
  handleAdminSettingsGet,
  handleAdminSettingsPost,
} from './handlers/admin.js';
import { handleCheckout } from './handlers/checkout.js';
import { handleSuccess } from './handlers/success.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Health and diagnostics
    if (path === '/' || path === '/health') {
      return json({ name: 'flare', ok: true });
    }
    if (path === '/db' && env.DB) {
      try {
        const row = await env.DB.prepare('SELECT COUNT(*) as count FROM contact_submissions').first();
        return json({ d1: 'ok', submissions_count: row?.count ?? 0 });
      } catch (e) {
        return json({ d1: 'error', message: e.message }, 500);
      }
    }
    if (path === '/db') return json({ d1: 'not_configured' }, 501);
    if (path === '/r2') {
      if (!env.REPORTS) return json({ r2: 'not_configured' }, 501);
      return json({ r2: 'ok', bucket: 'flare-reports' });
    }
    if (path === '/queue') {
      if (!env.JOBS) return json({ queue: 'not_configured' }, 501);
      if (method === 'POST') {
        try {
          await env.JOBS.send({ type: 'test', at: new Date().toISOString() });
          return json({ queue: 'ok', message: 'Test message sent' });
        } catch (e) {
          return json({ queue: 'error', message: e.message }, 500);
        }
      }
      return json({ queue: 'ok', hint: 'POST to send a test message' });
    }

    // Stripe
    if (method === 'POST' && (path === '/api/webhooks/stripe' || path === '/api/stripe-webhook')) {
      return handleStripeWebhook(request, env);
    }
    if (method === 'POST' && path === '/api/checkout') {
      return handleCheckout(request, env);
    }
    if (method === 'GET' && path === '/api/success') {
      return handleSuccess(url, env);
    }

    // Assessment
    if (method === 'GET' && path === '/assessment') {
      return handleAssessmentGate(url, env);
    }
    if (method === 'GET' && path === '/api/assessment-template') {
      return handleAssessmentTemplateGet(env);
    }
    if (method === 'POST' && path === '/api/assessments') {
      return handleAssessmentsPost(request, env);
    }

    // Report (public)
    if (method === 'GET' && path === '/report') {
      return handleReportView(url, env);
    }

    // Admin (optional auth via ADMIN_SECRET Bearer)
    if (path.startsWith('/api/admin/') || path === '/api/reports/approve') {
      if (!requireAdmin(request, env)) {
        return json({ error: 'Unauthorized' }, 401);
      }
    }
    if (method === 'GET' && path === '/api/admin/submissions') {
      return handleAdminSubmissions(env);
    }
    if (method === 'GET' && path === '/api/admin/reports') {
      return handleAdminReports(env);
    }
    if (method === 'GET' && path === '/api/admin/payments') {
      return handleAdminPayments(env);
    }
    if (method === 'GET' && path === '/api/admin/settings') {
      return handleAdminSettingsGet(env);
    }
    if (method === 'POST' && path === '/api/admin/settings') {
      return handleAdminSettingsPost(request, env);
    }
    const reportApproveMatch = path.match(/^\/api\/admin\/reports\/(\d+)\/approve$/);
    if (reportApproveMatch && method === 'POST') {
      return handleReportApprove(request, env, { reportId: reportApproveMatch[1] });
    }
    if (method === 'POST' && path === '/api/reports/approve') {
      return handleReportApprove(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },

  async queue(batch, env, ctx) {
    await handleQueueBatch(batch, env, ctx);
  },
};
