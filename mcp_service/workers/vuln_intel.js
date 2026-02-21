/**
 * Vulnerability intelligence: NVD JSON feed (cached in KV), optional WPScan for WordPress.
 * Filter: CVSS ≥7, last 90 days.
 */

const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const CACHE_KEY = 'nvd_recent';
const CACHE_TTL_SEC = 3600; // 1 hour

/**
 * @typedef {Object} CveItem
 * @property {string} cve_id
 * @property {number} cvss_score
 * @property {string} published_date
 * @property {string} summary
 * @property {string} exploitation_status
 */

/**
 * Fetch NVD feed (last 90 days), optionally from KV cache.
 * @param {{ NVD_CACHE?: KVNamespace }} env
 * @param {string[]} keywords - e.g. ['wordpress', 'microsoft 365']
 * @returns {Promise<CveItem[]>}
 */
export async function getRelevantVulnerabilities(env, keywords = []) {
  const cache = env.NVD_CACHE;
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 90);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);

  let cached = null;
  if (cache) {
    try {
      cached = await cache.get(CACHE_KEY, { type: 'json' });
    } catch (_) {}
  }

  let items = Array.isArray(cached?.items) ? cached.items : [];
  if (items.length === 0) {
    try {
      const url = `${NVD_BASE}?resultsPerPage=50&pubStartDate=${startStr}T00:00:00.000&pubEndDate=${endStr}T23:59:59.999`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        cf: { cacheTtl: 600 },
      });
      if (!res.ok) return [];
      const data = await res.json();
      items = data.vulnerabilities || [];
      if (cache && Array.isArray(items)) {
        await cache.put(CACHE_KEY, JSON.stringify({ items, fetched: new Date().toISOString() }), {
          expirationTtl: CACHE_TTL_SEC,
        });
      }
    } catch (_) {
      items = [];
    }
  }
  const kws = keywords.map((k) => k.toLowerCase());
  const result = [];

  for (const v of items) {
    const cve = v.cve || {};
    const metrics = cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV30?.[0] || cve.metrics?.cvssMetricV2?.[0];
    const score = metrics?.cvssData?.baseScore;
    if (score == null || score < 7) continue;

    const desc = (cve.descriptions || []).find((d) => d.lang === 'en')?.value || '';
    const matchKeyword = kws.length === 0 || kws.some((kw) => desc.toLowerCase().includes(kw) || (cve.id || '').toLowerCase().includes(kw));

    if (!matchKeyword) continue;

    const published = cve.published || '';
    result.push({
      cve_id: cve.id || 'CVE-unknown',
      cvss_score: score,
      published_date: published.slice(0, 10),
      summary: desc.slice(0, 300),
      exploitation_status: 'unknown',
    });
  }

  return result.slice(0, 20);
}

/**
 * Build keywords from payload (WordPress, M365, etc.).
 * @param {{ uses_wordpress: boolean; uses_m365: boolean; domain: string }} payload
 * @returns {string[]}
 */
export function vulnerabilityKeywords(payload) {
  const kw = [];
  if (payload.uses_wordpress) kw.push('wordpress');
  if (payload.uses_m365) kw.push('microsoft', 'office 365', 'm365');
  return kw;
}
