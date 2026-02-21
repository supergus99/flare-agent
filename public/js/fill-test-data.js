/**
 * Fill assessment form with test data (for full-cycle testing).
 * Loaded by assessment template so the "Fill with test data" button works
 * without relying on inline script (avoids ERR_BLOCKED_BY_CLIENT from blockers).
 */
(function() {
  function setVal(id, value) {
    var el = document.getElementById(id);
    if (el && value !== undefined && value !== null) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function setCheck(id, checked) {
    var el = document.getElementById(id);
    if (el) {
      el.checked = !!checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  window.fillFormWithTestData = function() {
    var form = document.getElementById('assessmentForm');
    if (!form) return;
    setVal('contact_name', 'Test User');
    setVal('email', 'test@example.com');
    setVal('company_name', 'Test Company Ltd');
    setVal('role', 'Owner/Founder');
    setVal('number_of_people', '2-5');
    setVal('industry', 'Professional Services');
    setVal('business_type', 'LLC');
    setRadio('public_website', 'Yes');
    setVal('website_platform', 'Custom built');
    setVal('website_url', 'https://example.com');
    setRadio('website_admin_access', 'A few trusted people');
    setRadio('website_updates', 'We do');
    setCheck('region_eu', true);
    setVal('report_language', 'en');
    setVal('data_hosted', 'EU');
    setVal('email_provider', 'Google Workspace');
    setCheck('store_google', true);
    setCheck('store_local', true);
    setCheck('chat_teams', true);
    setVal('track_customers', 'Yes (CRM or similar)');
    setVal('accounting_tool', 'QuickBooks or similar');
    setVal('payment_processing', 'Stripe/PayPal/Square/Shopify');
    setCheck('other_none', true);
    setVal('tools_count', '1-5');
    setRadio('custom_software', 'No');
    setVal('login_count', '2-5');
    setCheck('outside_none', true);
    setRadio('share_passwords', 'Rarely');
    setRadio('mfa_email', 'No');
    setRadio('mfa_other_tools', 'Yes (some tools)');
    setRadio('password_manager', 'Yes (some people)');
    setRadio('admin_access', 'Only people who need it');
    setRadio('offboard_speed', 'Same day');
    setRadio('screen_lock', 'Some devices');
    setRadio('account_recovery', 'We figure it out each time');
    setRadio('accounts_inventory', 'Partially');
    setCheck('cust_name', true);
    setCheck('cust_payment', true);
    setCheck('cust_history', true);
    setCheck('emp_contact', true);
    setCheck('important_cloud', true);
    setCheck('important_local', true);
    setCheck('important_db', true);
    setRadio('delete_data', 'Yes (informal)');
    setRadio('customer_data_request', 'Sometimes');
    setRadio('devices_encrypted', 'Some');
    setRadio('secure_file_sharing', 'Sometimes');
    setRadio('privacy_policy', 'Yes');
    setRadio('limit_sensitive_access', 'Yes');
    setRadio('backup_method', 'We rely on cloud tools only (Google/Microsoft/etc.)');
    setVal('backup_frequency', 'Daily');
    setRadio('backup_tested', 'Never');
    setCheck('backup_data_computer', true);
    setCheck('backup_data_cloud', true);
    setRadio('computer_protection', 'Built-in only (Windows/macOS)');
    setRadio('updates_handled', 'Sometimes');
    setRadio('device_inventory', 'Partially');
    setRadio('work_location', 'Fully remote');
    setRadio('vpn', 'Yes (sometimes)');
    setVal('wifi_security', 'WPA2');
    setRadio('guest_wifi', 'No');
    setRadio('accept_payments', 'Yes');
    setVal('how_accept_payments', 'Payment processor (Stripe/PayPal/Square/Shopify)');
    setRadio('card_numbers_direct', 'Never');
    setRadio('store_card_details', 'No');
    setCheck('fraud_alerts', true);
    setRadio('payment_scam_attempt', 'No');
    setVal('amount_lost', '');
    setRadio('byod', 'Yes');
    setRadio('byod_protections', "We don't require anything");
    setCheck('alerts_email', true);
    setCheck('alerts_mfa', true);
    setCheck('alerts_bank', true);
    setVal('who_receives_alerts', 'Owner');
    setRadio('hack_checklist', 'We have an idea but not written');
    setCheck('call_bank', true);
    setCheck('past_phishing', true);
    setVal('incident_details', '');
    setRadio('legal_requirements', 'None that we know of');
    setRadio('dpa_with_vendors', 'Never');
    setRadio('vendor_security_check', 'Sometimes');
    setRadio('security_training', 'Not applicable (solo)');
    setRadio('phishing_tests', 'No');
    setRadio('cyber_insurance', 'No');
    setRadio('security_checkup', 'Only when something breaks');
    setCheck('concern_email', true);
    setCheck('concern_ransomware', true);
    setVal('describe_concerns', 'Test submission for full-cycle check.');
    setVal('improvements_timeline', '1-3 months');
    setVal('budget_range', '<$1k');
    setRadio('consent_assessment', 'Yes');
    if (typeof toggleConditionals === 'function') toggleConditionals();
    form.dispatchEvent(new Event('change', { bubbles: true }));
    alert('Test data filled. Review and submit when ready.');
  };
})();
