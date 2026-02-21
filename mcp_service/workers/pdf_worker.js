/**
 * PDF generation: store HTML in R2; optionally call external PDF service.
 * If PDF_SERVICE_URL is set, call it with HTML and store returned PDF in R2. Otherwise store HTML and return report URL.
 */

/**
 * @param {object} env - { REPORTS: R2Bucket, PDF_SERVICE_URL?: string }
 * @param {string} submissionId
 * @param {string} htmlContent - full HTML report
 * @returns {Promise<{ report_url: string; pdf_url?: string; content_type: string }>}
 */
export async function generateAndStoreReport(env, submissionId, htmlContent) {
  const key = `reports/${submissionId}/${Date.now()}.html`;
  await env.REPORTS.put(key, htmlContent, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  const pdfServiceUrl = env.PDF_SERVICE_URL;
  if (pdfServiceUrl) {
    try {
      const res = await fetch(pdfServiceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/html' },
        body: htmlContent,
      });
      if (res.ok && res.headers.get('content-type')?.includes('pdf')) {
        const pdfBytes = await res.arrayBuffer();
        const pdfKey = `reports/${submissionId}/${Date.now()}.pdf`;
        await env.REPORTS.put(pdfKey, pdfBytes, {
          httpMetadata: { contentType: 'application/pdf' },
        });
        return {
          report_url: key,
          pdf_url: pdfKey,
          content_type: 'application/pdf',
        };
      }
    } catch (_) {}
  }

  return {
    report_url: key,
    content_type: 'text/html',
  };
}
