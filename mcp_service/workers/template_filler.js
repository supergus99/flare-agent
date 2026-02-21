/**
 * Fill report template with MCP JSON + submission payload.
 * Placeholders: {{domain}}, {{submission_id}}, {{overall_risk_score}}, etc.
 */

import { REPORT_TEMPLATE } from './template-report.js';

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Apply vars to template (no HTML injection for non-ai keys).
 * @param {string} templateBody
 * @param {Record<string, string | number | undefined | null>} vars
 * @param {{ allowHtml?: string[] }} [opts] - keys that may contain HTML
 * @returns {string}
 */
export function applyReportTemplate(templateBody, vars, opts = {}) {
  const allowHtml = new Set(opts.allowHtml || []);
  let out = templateBody;
  for (const [key, value] of Object.entries(vars)) {
    const str = value != null ? String(value) : '';
    const safe = allowHtml.has(key) ? str : escapeHtml(str);
    const pattern = new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, 'g');
    out = out.replace(pattern, safe);
  }
  return out;
}

/**
 * Build template vars from MCP enrichment + payload.
 * @param {object} mcp - merged MCP result (domain_intelligence, industry_context, financial_estimate, etc.)
 * @param {object} payload - AssessmentPayload
 * @param {string} generatedAt - ISO date string
 */
export function buildTemplateVars(mcp, payload, generatedAt) {
  const domain = mcp.domain_intelligence || {};
  const dns = domain.dns || {};
  const ssl = domain.ssl || {};
  const email = domain.email_security || {};
  const riskFlags = (domain.risk_flags || []).map((f) => `${f.code} (${f.severity}): ${f.description}`).join('; ') || 'None';

  const industry = mcp.industry_context || {};
  const financial = mcp.financial_estimate || {};
  const breachRange = financial.estimated_breach_impact_range || {};
  const controlGap = mcp.control_gap_analysis || {};
  const gaps = (controlGap.gaps || []).map((g) => g.description || g.code).join('; ') || 'None identified';

  const vulns = (mcp.vulnerability_context || {}).items || mcp.vulnerability_context || [];
  const vulnList = Array.isArray(vulns)
    ? vulns.map((v) => `${v.cve_id} (CVSS ${v.cvss_score}) – ${(v.summary || '').slice(0, 120)}`).join('<br>')
    : 'No high-severity CVEs in scope.';

  const summary = mcp.summary || {};
  const score = summary.overall_risk_score != null ? summary.overall_risk_score : 65;
  const level = summary.risk_level || 'moderate';
  const drivers = summary.primary_risk_drivers || 'Domain and control gaps';

  return {
    domain: payload.domain,
    submission_id: payload.submission_id,
    generated_at: generatedAt,
    overall_risk_score: score,
    risk_level: level,
    primary_risk_drivers: drivers,
    ssl_status: ssl.valid ? 'Valid' : 'Invalid or unreachable',
    ssl_expires: ssl.expires_in_days ?? '—',
    spf_status: email.spf || '—',
    dmarc_status: email.dmarc || '—',
    dkim_status: email.dkim || '—',
    risk_flags: riskFlags,
    vulnerability_summary: vulnList,
    industry: industry.industry || payload.industry || '—',
    incident_rate: industry.incident_rate != null ? industry.incident_rate : '—',
    avg_breach_cost: industry.avg_breach_cost != null ? industry.avg_breach_cost : '—',
    phishing_rate: industry.phishing_rate != null ? industry.phishing_rate : '—',
    ransomware_rate: industry.ransomware_rate != null ? industry.ransomware_rate : '—',
    industry_risk_level: industry.industry_risk_level || '—',
    annualized_risk_exposure: financial.annualized_risk_exposure != null ? financial.annualized_risk_exposure : '—',
    estimated_downtime_cost: financial.estimated_downtime_cost != null ? financial.estimated_downtime_cost : '—',
    breach_impact_low: breachRange.low != null ? breachRange.low : '—',
    breach_impact_high: breachRange.high != null ? breachRange.high : '—',
    control_gap_summary: gaps,
  };
}

/**
 * Produce filled HTML from default template and vars.
 * @param {Record<string, string | number | undefined | null>} vars
 * @returns {string} HTML
 */
export function fillReportHtml(vars) {
  return applyReportTemplate(REPORT_TEMPLATE, vars, { allowHtml: ['vulnerability_summary', 'control_gap_summary'] });
}
