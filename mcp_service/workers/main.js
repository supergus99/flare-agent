/**
 * MCP Enrichment Service – Worker entrypoint.
 * POST /enrich-assessment → enqueue job → return "submission received, report generating".
 * Queue consumer → orchestrator → PDF/store → email → KV metadata only (no MCP JSON stored).
 */

import { parseAssessmentPayload } from './models.js';
import { runOrchestrator } from './orchestrator.js';
import { generateAndStoreReport } from './pdf_worker.js';
import { sendReportEmail } from './email_sender.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/enrich-assessment') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const parsed = parseAssessmentPayload(body);
    if (!parsed.ok) {
      return new Response(JSON.stringify({ error: parsed.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!env.JOBS) {
      return new Response(JSON.stringify({ error: 'Queue not configured (JOBS binding)' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await env.JOBS.send({
      type: 'enrich_and_deliver',
      payload: parsed.payload,
    });

    return new Response(
      JSON.stringify({
        message: 'Submission received, report generating.',
        submission_id: parsed.payload.submission_id,
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },

  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      try {
        const { type, payload } = msg.body || {};
        if (type !== 'enrich_and_deliver' || !payload) {
          msg.ack();
          continue;
        }

        const { submission_id, user_email } = payload;
        const runAi = !!(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY);

        const { html } = await runOrchestrator(env, payload, { runAiEnrichment: runAi });
        const stored = await generateAndStoreReport(env, submission_id, html);

        const reportUrl = stored.report_url;
        const pdfUrl = stored.pdf_url;
        const reportDisplayUrl = reportUrl || pdfUrl;

        if (user_email) {
          await sendReportEmail(env, {
            to: user_email,
            subject: `Your risk report is ready – ${payload.domain}`,
            htmlBody: `<p>Your security risk report for <strong>${payload.domain}</strong> is ready.</p><p>Submission ID: ${submission_id}</p>`,
            reportUrl: reportDisplayUrl,
            pdfUrl: pdfUrl || undefined,
          });
        }

        if (env.REPORT_META) {
          await env.REPORT_META.put(
            submission_id,
            JSON.stringify({
              pdf_url: pdfUrl || null,
              report_url: reportUrl,
              report_text: html.slice(0, 500),
              generated_at: new Date().toISOString(),
            }),
            { expirationTtl: 60 * 60 * 24 * 90 }
          );
        }

        msg.ack();
      } catch (err) {
        console.error('Queue message failed:', err);
        msg.retry();
      }
    }
  },
};
