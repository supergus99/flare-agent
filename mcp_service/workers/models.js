/**
 * Input/Output models for MCP Enrichment MVP.
 * MCP JSON is transient – never persisted; only submission_id + report metadata stored.
 */

/**
 * @typedef {Object} AssessmentPayload
 * @property {string} submission_id
 * @property {string} domain
 * @property {string} industry
 * @property {number} employee_count
 * @property {string} revenue_range
 * @property {boolean} uses_wordpress
 * @property {boolean} uses_m365
 * @property {{ mfa: boolean; backup: boolean; endpoint_protection: boolean }} controls
 * @property {string} user_email
 */

/**
 * @typedef {Object} MCPEnrichmentResponse
 * @property {string} schema_version
 * @property {object} summary
 * @property {object} domain_intelligence
 * @property {object} vulnerability_context
 * @property {object} industry_context
 * @property {object} financial_estimate
 * @property {object} control_gap_analysis
 * @property {object} confidence
 * @property {string} generated_at
 */

/**
 * Validate and normalize AssessmentPayload from request body.
 * @param {unknown} body
 * @returns {{ ok: true; payload: AssessmentPayload } | { ok: false; error: string }}
 */
export function parseAssessmentPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Missing or invalid JSON body' };
  }
  const b = /** @type {Record<string, unknown>} */ (body);
  const submission_id = typeof b.submission_id === 'string' ? b.submission_id : String(b.submission_id ?? '');
  const domain = typeof b.domain === 'string' ? b.domain.trim() : '';
  const industry = typeof b.industry === 'string' ? b.industry : String(b.industry ?? '');
  const employee_count = typeof b.employee_count === 'number' ? b.employee_count : parseInt(String(b.employee_count ?? '0'), 10) || 0;
  const revenue_range = typeof b.revenue_range === 'string' ? b.revenue_range : String(b.revenue_range ?? '');
  const uses_wordpress = Boolean(b.uses_wordpress);
  const uses_m365 = Boolean(b.uses_m365);
  const user_email = typeof b.user_email === 'string' ? b.user_email.trim() : '';

  let controls = { mfa: false, backup: false, endpoint_protection: false };
  if (b.controls && typeof b.controls === 'object') {
    const c = /** @type {Record<string, unknown>} */ (b.controls);
    controls = {
      mfa: Boolean(c.mfa),
      backup: Boolean(c.backup),
      endpoint_protection: Boolean(c.endpoint_protection),
    };
  }

  if (!submission_id) return { ok: false, error: 'submission_id is required' };
  if (!domain) return { ok: false, error: 'domain is required' };
  if (!user_email) return { ok: false, error: 'user_email is required' };

  return {
    ok: true,
    payload: {
      submission_id,
      domain,
      industry,
      employee_count,
      revenue_range,
      uses_wordpress,
      uses_m365,
      controls,
      user_email,
    },
  };
}
