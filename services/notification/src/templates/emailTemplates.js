const Handlebars = require('handlebars');

const declinedCustomerTemplate = Handlebars.compile(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Transaction Declined</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500;600&family=DM+Mono&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'DM Sans', Helvetica, Arial, sans-serif;
      font-weight: 400;
      background-color: #F0EDE8;
      color: #1A1A1A;
      -webkit-font-smoothing: antialiased;
    }

    .wrapper {
      background-color: #F0EDE8;
      padding: 48px 16px;
    }

    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #FAFAF8;
      border: 1px solid #D8D3CC;
    }

    .header {
      background-color: #1A0A0A;
      padding: 40px 48px;
      border-bottom: 3px solid #8B1A1A;
    }

    .header-eyebrow {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 11px;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: #8B1A1A;
      margin-bottom: 12px;
    }

    .header-title {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 28px;
      font-weight: 400;
      color: #FAFAF8;
      line-height: 1.2;
    }

    .body {
      padding: 40px 48px;
    }

    .intro {
      font-size: 15px;
      line-height: 1.7;
      color: #3D3D3D;
      margin-bottom: 32px;
      border-left: 2px solid #8B1A1A;
      padding-left: 16px;
    }

    .section-label {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #8B8078;
      margin-bottom: 12px;
    }

    .detail-block {
      background-color: #F0EDE8;
      border: 1px solid #D8D3CC;
      padding: 24px;
      margin-bottom: 24px;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 8px 0;
      border-bottom: 1px solid #E2DDD8;
      font-size: 14px;
    }

    .detail-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .detail-row:first-child {
      padding-top: 0;
    }

    .detail-label {
      color: #6B6560;
      font-weight: 500;
      font-size: 13px;
    }

    .detail-value {
      color: #1A1A1A;
      font-weight: 500;
      text-align: right;
    }

    .detail-value.mono {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 12px;
      letter-spacing: 0.02em;
    }

    .reason-block {
      background-color: #FDF6F6;
      border: 1px solid #E8C5C5;
      border-left: 3px solid #8B1A1A;
      padding: 20px 24px;
      margin-bottom: 32px;
    }

    .reason-block .section-label {
      margin-bottom: 8px;
    }

    .reason-text {
      font-size: 14px;
      color: #5C2020;
      line-height: 1.6;
    }

    .divider {
      border: none;
      border-top: 1px solid #D8D3CC;
      margin: 32px 0;
    }

    .contact-heading {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 16px;
      color: #1A1A1A;
      margin-bottom: 12px;
    }

    .contact-text {
      font-size: 14px;
      color: #3D3D3D;
      line-height: 1.7;
      margin-bottom: 12px;
    }

    .contact-info {
      background-color: #F0EDE8;
      border: 1px solid #D8D3CC;
      padding: 16px 24px;
      font-size: 13px;
      color: #3D3D3D;
    }

    .contact-info p {
      padding: 4px 0;
    }

    .contact-info strong {
      color: #1A1A1A;
    }

    .notice {
      margin-top: 24px;
      font-size: 13px;
      color: #6B6560;
      line-height: 1.6;
    }

    .footer {
      background-color: #1A1A1A;
      padding: 24px 48px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .footer-brand {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 14px;
      color: #FAFAF8;
      letter-spacing: 0.02em;
    }

    .footer-meta {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 10px;
      color: #6B6560;
      text-align: right;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">

      <div class="header">
        <div class="header-eyebrow">Security Alert - Action May Be Required</div>
        <div class="header-title">Transaction Declined</div>
      </div>

      <div class="body">
        <p class="intro">
          We declined a recent transaction on your account due to security concerns.
          Please review the details below and contact us if you believe this was an error.
        </p>

        <div class="section-label">Transaction Details</div>
        <div class="detail-block">
          <div class="detail-row">
            <span class="detail-label">Transaction ID</span>
            <span class="detail-value mono">{{transactionId}}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Amount</span>
            <span class="detail-value">{{amount}} {{currency}}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Merchant</span>
            <span class="detail-value">{{merchantId}}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Date &amp; Time</span>
            <span class="detail-value">{{timestamp}}</span>
          </div>
        </div>

        <div class="reason-block">
          <div class="section-label">Reason for Decline</div>
          <div class="reason-text">{{decisionReason}}</div>
        </div>

        <hr class="divider" />

        <div class="contact-heading">Need Assistance?</div>
        <p class="contact-text">
          If you authorised this transaction and believe it was declined in error,
          please reach out to our fraud prevention team immediately.
        </p>
        <div class="contact-info">
          <p><strong>Email</strong> &nbsp; {{supportEmail}}</p>
          <p><strong>Phone</strong> &nbsp; {{supportPhone}}</p>
        </div>

        <p class="notice">
          If you did not attempt this transaction, no action is required.
          Our systems have already blocked it to protect your account.
        </p>
      </div>

      <div class="footer">
        <span class="footer-brand">Fraud Detection Platform</span>
        <div class="footer-meta">
          Automated security notification<br />
          Do not reply to this message
        </div>
      </div>

    </div>
  </div>
</body>
</html>
`);


const declinedFraudTeamTemplate = Handlebars.compile(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Fraud Alert - Transaction Declined</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500;600&family=DM+Mono&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'DM Sans', Helvetica, Arial, sans-serif;
      background-color: #0F0F0F;
      color: #E8E4DF;
      -webkit-font-smoothing: antialiased;
    }

    .wrapper {
      background-color: #0F0F0F;
      padding: 48px 16px;
    }

    .container {
      max-width: 680px;
      margin: 0 auto;
      background-color: #161616;
      border: 1px solid #2A2A2A;
    }

    .header {
      background-color: #8B1A1A;
      padding: 32px 48px;
    }

    .header-eyebrow {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 10px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #F5C5C5;
      margin-bottom: 10px;
    }

    .header-title {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 26px;
      font-weight: 400;
      color: #FFFFFF;
    }

    .header-meta {
      margin-top: 8px;
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.5);
      letter-spacing: 0.04em;
    }

    .status-bar {
      background-color: #1E1010;
      border-bottom: 1px solid #2A2A2A;
      padding: 14px 48px;
      display: flex;
      gap: 32px;
    }

    .status-item {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 11px;
    }

    .status-item .label {
      color: #6B6560;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-right: 8px;
    }

    .status-item .value {
      color: #E8E4DF;
      font-weight: 600;
    }

    .status-item .value.declined { color: #F87171; }
    .status-item .value.score-high { color: #F87171; }
    .status-item .value.score-mid { color: #FBBF24; }

    .body {
      padding: 36px 48px;
    }

    .section {
      margin-bottom: 32px;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 1px solid #2A2A2A;
    }

    .section-label {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 10px;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: #6B6560;
    }

    .section-line {
      flex: 1;
      height: 1px;
      background-color: #2A2A2A;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .data-cell {
      background-color: #1E1E1E;
      border: 1px solid #2A2A2A;
      padding: 14px 16px;
    }

    .data-cell .cell-label {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #6B6560;
      margin-bottom: 6px;
    }

    .data-cell .cell-value {
      font-size: 14px;
      color: #E8E4DF;
      font-weight: 500;
      word-break: break-all;
    }

    .data-cell .cell-value.mono {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 12px;
      letter-spacing: 0.02em;
    }

    .data-cell.full {
      grid-column: 1 / -1;
    }

    .risk-bar-container {
      margin-top: 8px;
    }

    .risk-bar-track {
      height: 4px;
      background-color: #2A2A2A;
      border-radius: 2px;
      margin-top: 8px;
      overflow: hidden;
    }

    .risk-bar-fill {
      height: 100%;
      background-color: #F87171;
      border-radius: 2px;
      width: {{riskScore}}%;
    }

    .reason-block {
      background-color: #1A0A0A;
      border: 1px solid #3D1515;
      border-left: 3px solid #8B1A1A;
      padding: 20px 24px;
      margin-bottom: 32px;
    }

    .reason-block .section-label {
      margin-bottom: 8px;
    }

    .reason-text {
      font-size: 14px;
      color: #F5C5C5;
      line-height: 1.6;
    }

    .code-block {
      background-color: #0A0A0A;
      border: 1px solid #2A2A2A;
      padding: 20px 24px;
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 12px;
      color: #9B9590;
      line-height: 1.7;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .action-block {
      background-color: #1E1E1E;
      border: 1px solid #2A2A2A;
      padding: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 8px;
    }

    .action-text {
      font-size: 14px;
      color: #9B9590;
    }

    .action-link {
      display: inline-block;
      background-color: #8B1A1A;
      color: #FFFFFF;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      padding: 10px 20px;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }

    .footer {
      background-color: #0A0A0A;
      border-top: 1px solid #2A2A2A;
      padding: 20px 48px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .footer-brand {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 13px;
      color: #6B6560;
    }

    .footer-meta {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 10px;
      color: #3D3D3D;
      text-align: right;
      line-height: 1.8;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">

      <div class="header">
        <div class="header-eyebrow">Internal - Fraud Team Only</div>
        <div class="header-title">Transaction Declined</div>
        <div class="header-meta">Correlation ID: {{transactionId}}</div>
      </div>

      <div class="status-bar">
        <div class="status-item">
          <span class="label">Decision</span>
          <span class="value declined">DECLINED</span>
        </div>
        <div class="status-item">
          <span class="label">Risk Score</span>
          <span class="value score-high">{{riskScore}} / 100</span>
        </div>
        <div class="status-item">
          <span class="label">ML Score</span>
          <span class="value">{{mlScore}} / 100</span>
        </div>
        <div class="status-item">
          <span class="label">Rules Flagged</span>
          <span class="value">{{fraudFlagged}}</span>
        </div>
      </div>

      <div class="body">

        <div class="section">
          <div class="section-header">
            <div class="section-label">Transaction</div>
            <div class="section-line"></div>
          </div>
          <div class="grid-2">
            <div class="data-cell full">
              <div class="cell-label">Transaction ID</div>
              <div class="cell-value mono">{{transactionId}}</div>
            </div>
            <div class="data-cell">
              <div class="cell-label">Customer ID</div>
              <div class="cell-value mono">{{customerId}}</div>
            </div>
            <div class="data-cell">
              <div class="cell-label">Merchant</div>
              <div class="cell-value">{{merchantId}}</div>
            </div>
            <div class="data-cell">
              <div class="cell-label">Amount</div>
              <div class="cell-value">{{amount}} {{currency}}</div>
            </div>
            <div class="data-cell">
              <div class="cell-label">Location</div>
              <div class="cell-value">{{location}}</div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <div class="section-label">Risk Assessment</div>
            <div class="section-line"></div>
          </div>
          <div class="grid-2">
            <div class="data-cell">
              <div class="cell-label">Composite Risk Score</div>
              <div class="cell-value">{{riskScore}} / 100</div>
              <div class="risk-bar-container">
                <div class="risk-bar-track">
                  <div class="risk-bar-fill"></div>
                </div>
              </div>
            </div>
            <div class="data-cell">
              <div class="cell-label">ML Model Score</div>
              <div class="cell-value">{{mlScore}} / 100</div>
            </div>
          </div>
        </div>

        <div class="reason-block">
          <div class="section-label">Decision Reason</div>
          <div class="reason-text">{{decisionReason}}</div>
        </div>

        <div class="section">
          <div class="section-header">
            <div class="section-label">Decision Factors</div>
            <div class="section-line"></div>
          </div>
          <div class="code-block">{{decisionFactorsJson}}</div>
        </div>

        <div class="action-block">
          <div class="action-text">Review full transaction record in the fraud management dashboard.</div>
          <a class="action-link" href="https://fraud-dashboard.example.com/transactions/{{transactionId}}">View Record</a>
        </div>

      </div>

      <div class="footer">
        <span class="footer-brand">Fraud Detection Platform</span>
        <div class="footer-meta">
          Internal use only - do not forward<br />
          Automated alert · Decision Engine v{{decisionVersion}}
        </div>
      </div>

    </div>
  </div>
</body>
</html>
`);


const flaggedFraudTeamTemplate = Handlebars.compile(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Manual Review Required</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500;600&family=DM+Mono&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'DM Sans', Helvetica, Arial, sans-serif;
      background-color: #0F0E0A;
      color: #E8E4DF;
      -webkit-font-smoothing: antialiased;
    }

    .wrapper {
      background-color: #0F0E0A;
      padding: 48px 16px;
    }

    .container {
      max-width: 680px;
      margin: 0 auto;
      background-color: #161510;
      border: 1px solid #2A2820;
    }

    .header {
      background-color: #78350F;
      padding: 32px 48px;
    }

    .header-eyebrow {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 10px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #FDE68A;
      margin-bottom: 10px;
    }

    .header-title {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 26px;
      font-weight: 400;
      color: #FFFFFF;
    }

    .header-meta {
      margin-top: 8px;
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.5);
      letter-spacing: 0.04em;
    }

    .status-bar {
      background-color: #1A1505;
      border-bottom: 1px solid #2A2820;
      padding: 14px 48px;
      display: flex;
      gap: 32px;
    }

    .status-item {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 11px;
    }

    .status-item .label {
      color: #6B6550;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-right: 8px;
    }

    .status-item .value {
      color: #E8E4DF;
      font-weight: 600;
    }

    .status-item .value.flagged { color: #FBBF24; }

    .body {
      padding: 36px 48px;
    }

    .intro {
      font-size: 14px;
      line-height: 1.7;
      color: #9B9580;
      margin-bottom: 32px;
      padding: 16px 20px;
      border: 1px solid #2A2820;
      border-left: 3px solid #78350F;
      background-color: #1A1505;
    }

    .section {
      margin-bottom: 32px;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 1px solid #2A2820;
    }

    .section-label {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 10px;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: #6B6550;
    }

    .section-line {
      flex: 1;
      height: 1px;
      background-color: #2A2820;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .data-cell {
      background-color: #1E1C10;
      border: 1px solid #2A2820;
      padding: 14px 16px;
    }

    .data-cell.full {
      grid-column: 1 / -1;
    }

    .data-cell .cell-label {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #6B6550;
      margin-bottom: 6px;
    }

    .data-cell .cell-value {
      font-size: 14px;
      color: #E8E4DF;
      font-weight: 500;
      word-break: break-all;
    }

    .data-cell .cell-value.mono {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 12px;
      letter-spacing: 0.02em;
    }

    .risk-bar-track {
      height: 4px;
      background-color: #2A2820;
      border-radius: 2px;
      margin-top: 8px;
      overflow: hidden;
    }

    .risk-bar-fill {
      height: 100%;
      background-color: #FBBF24;
      border-radius: 2px;
      width: {{riskScore}}%;
    }

    .reason-block {
      background-color: #1A1505;
      border: 1px solid #3D3010;
      border-left: 3px solid #78350F;
      padding: 20px 24px;
      margin-bottom: 32px;
    }

    .reason-block .section-label {
      margin-bottom: 8px;
    }

    .reason-text {
      font-size: 14px;
      color: #FDE68A;
      line-height: 1.6;
    }

    .steps-block {
      background-color: #1E1C10;
      border: 1px solid #2A2820;
      padding: 24px;
      margin-bottom: 24px;
    }

    .step {
      display: flex;
      gap: 16px;
      padding: 10px 0;
      border-bottom: 1px solid #2A2820;
      font-size: 14px;
      color: #9B9580;
      line-height: 1.5;
    }

    .step:last-child { border-bottom: none; padding-bottom: 0; }
    .step:first-child { padding-top: 0; }

    .step-number {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 11px;
      color: #6B6550;
      min-width: 20px;
      padding-top: 2px;
    }

    .action-block {
      background-color: #1E1C10;
      border: 1px solid #2A2820;
      padding: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .action-text {
      font-size: 14px;
      color: #9B9580;
    }

    .action-link {
      display: inline-block;
      background-color: #78350F;
      color: #FFFFFF;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      padding: 10px 20px;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }

    .footer {
      background-color: #0A0900;
      border-top: 1px solid #2A2820;
      padding: 20px 48px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .footer-brand {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 13px;
      color: #6B6550;
    }

    .footer-meta {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 10px;
      color: #3D3D30;
      text-align: right;
      line-height: 1.8;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">

      <div class="header">
        <div class="header-eyebrow">Internal - Manual Review Required</div>
        <div class="header-title">Transaction Flagged</div>
        <div class="header-meta">Correlation ID: {{transactionId}}</div>
      </div>

      <div class="status-bar">
        <div class="status-item">
          <span class="label">Decision</span>
          <span class="value flagged">FLAGGED</span>
        </div>
        <div class="status-item">
          <span class="label">Risk Score</span>
          <span class="value">{{riskScore}} / 100</span>
        </div>
        <div class="status-item">
          <span class="label">Customer</span>
          <span class="value">{{customerId}}</span>
        </div>
      </div>

      <div class="body">

        <div class="intro">
          This transaction has been held for manual review. It was not automatically declined
          but exceeds the confidence threshold for straight-through processing.
          A member of the fraud team must make a final determination.
        </div>

        <div class="section">
          <div class="section-header">
            <div class="section-label">Transaction</div>
            <div class="section-line"></div>
          </div>
          <div class="grid-2">
            <div class="data-cell full">
              <div class="cell-label">Transaction ID</div>
              <div class="cell-value mono">{{transactionId}}</div>
            </div>
            <div class="data-cell">
              <div class="cell-label">Customer ID</div>
              <div class="cell-value mono">{{customerId}}</div>
            </div>
            <div class="data-cell">
              <div class="cell-label">Amount</div>
              <div class="cell-value">{{amount}} {{currency}}</div>
            </div>
            <div class="data-cell">
              <div class="cell-label">Merchant</div>
              <div class="cell-value">{{merchantId}}</div>
            </div>
            <div class="data-cell">
              <div class="cell-label">Risk Score</div>
              <div class="cell-value">{{riskScore}} / 100
                <div class="risk-bar-track">
                  <div class="risk-bar-fill"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="reason-block">
          <div class="section-label">Flag Reason</div>
          <div class="reason-text">{{decisionReason}}</div>
        </div>

        <div class="section">
          <div class="section-header">
            <div class="section-label">Required Actions</div>
            <div class="section-line"></div>
          </div>
          <div class="steps-block">
            <div class="step">
              <span class="step-number">01</span>
              <span>Review the full transaction record and fraud analysis report in the dashboard.</span>
            </div>
            <div class="step">
              <span class="step-number">02</span>
              <span>Verify customer identity against account history if the transaction pattern is unusual.</span>
            </div>
            <div class="step">
              <span class="step-number">03</span>
              <span>Manually approve or decline the transaction with a documented reason.</span>
            </div>
          </div>
        </div>

        <div class="action-block">
          <div class="action-text">Open the review queue to action this transaction.</div>
          <a class="action-link" href="https://fraud-dashboard.example.com/review/{{transactionId}}">Review Transaction</a>
        </div>

      </div>

      <div class="footer">
        <span class="footer-brand">Fraud Detection Platform</span>
        <div class="footer-meta">
          Internal use only - do not forward<br />
          Automated alert · Decision Engine v{{decisionVersion}}
        </div>
      </div>

    </div>
  </div>
</body>
</html>
`);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderReasonList(reasonHighlights) {
  if (!Array.isArray(reasonHighlights) || reasonHighlights.length === 0) {
    return '<li>Automated fraud controls identified unusual activity for this payment.</li>';
  }

  return reasonHighlights.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
}

function renderCustomerDecisionEmail({
  accentColor,
  eyebrow,
  title,
  intro,
  decisionSummary,
  nextSteps,
  data,
}) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f6f8;color:#132238;font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:32px 16px;">
    <div style="background:#ffffff;border:1px solid #d8dfe8;border-radius:18px;overflow:hidden;">
      <div style="padding:28px 32px;background:${accentColor};color:#ffffff;">
        <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;margin-bottom:10px;">${escapeHtml(eyebrow)}</div>
        <div style="font-size:28px;font-weight:700;line-height:1.2;">${escapeHtml(title)}</div>
      </div>
      <div style="padding:28px 32px;">
        <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#314255;">${escapeHtml(intro)}</p>
        <div style="background:#f8fafc;border:1px solid #dde5ee;border-radius:14px;padding:18px 20px;margin-bottom:20px;">
          <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#617184;margin-bottom:10px;">Transaction Snapshot</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:14px;color:#132238;">
            <div><strong>Reference</strong><br />${escapeHtml(data.referenceId)}</div>
            <div><strong>Amount</strong><br />${escapeHtml(data.amount)} ${escapeHtml(data.currency)}</div>
            <div><strong>Merchant</strong><br />${escapeHtml(data.merchantId)}</div>
            <div><strong>Date</strong><br />${escapeHtml(data.timestamp)}</div>
          </div>
        </div>
        <div style="background:#fdf7ec;border:1px solid #f4d6a0;border-radius:14px;padding:18px 20px;margin-bottom:20px;">
          <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8b5e00;margin-bottom:8px;">Why you are receiving this</div>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#5f4200;">${escapeHtml(decisionSummary)}</p>
          <ul style="margin:0;padding-left:18px;color:#5f4200;font-size:14px;line-height:1.6;">
            ${renderReasonList(data.reasonHighlights)}
          </ul>
        </div>
        <div style="margin-bottom:20px;">
          <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#617184;margin-bottom:8px;">What to do next</div>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#314255;">${escapeHtml(nextSteps)}</p>
        </div>
        <div style="background:#f8fafc;border:1px solid #dde5ee;border-radius:14px;padding:16px 20px;font-size:13px;line-height:1.7;color:#44576d;">
          <div><strong>Portal:</strong> <a href="${escapeHtml(data.portalUrl)}">${escapeHtml(data.portalUrl)}</a></div>
          <div><strong>Support email:</strong> ${escapeHtml(data.supportEmail)}</div>
          <div><strong>Support phone:</strong> ${escapeHtml(data.supportPhone)}</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

  const reasonLines = Array.isArray(data.reasonHighlights) && data.reasonHighlights.length > 0
    ? `${data.reasonHighlights.map((reason) => `- ${reason}`).join('\n')}\n\n`
    : '';

  return {
    html,
    text: `${title}\n\n${intro}\n\nReference: ${data.referenceId}\nAmount: ${data.amount} ${data.currency}\nMerchant: ${data.merchantId}\n\nReason: ${decisionSummary}\n${reasonLines}Next steps: ${nextSteps}\nPortal: ${data.portalUrl}\nSupport: ${data.supportEmail} / ${data.supportPhone}`,
  };
}


// Handles render declined customer email.
function renderDeclinedCustomerEmail(data) {
  return {
    subject: `Transaction Declined - Reference ${data.transactionId.substring(0, 8).toUpperCase()}`,
    html: declinedCustomerTemplate(data),
    text: `Transaction Declined\n\nYour transaction for ${data.amount} ${data.currency} at ${data.merchantId} has been declined.\n\nReason: ${data.decisionReason}\n\nTransaction ID: ${data.transactionId}\n\nIf you recognise this transaction and want it reviewed, sign in to ${data.portalUrl}. If you do not recognise it, no further action is required.\n\nSupport: ${data.supportEmail} / ${data.supportPhone}`,
  };
}

// Handles render declined fraud team email.
function renderDeclinedFraudTeamEmail(data) {
  return {
    subject: `DECLINED - ${data.customerId} - ${data.amount} ${data.currency} - Score ${data.riskScore}/100`,
    html: declinedFraudTeamTemplate({
      ...data,
      decisionFactorsJson: JSON.stringify(data.decisionFactors, null, 2),
    }),
    text: `FRAUD ALERT: Transaction Declined\n\nTransaction ID: ${data.transactionId}\nCustomer: ${data.customerId}\nAmount: ${data.amount} ${data.currency}\nMerchant: ${data.merchantId}\nRisk Score: ${data.riskScore}/100\nML Score: ${data.mlScore}/100\nDecision: DECLINED\nReason: ${data.decisionReason}`,
  };
}

// Handles render flagged fraud team email.
function renderFlaggedFraudTeamEmail(data) {
  return {
    subject: `REVIEW REQUIRED - ${data.customerId} - ${data.amount} ${data.currency} - Score ${data.riskScore}/100`,
    html: flaggedFraudTeamTemplate(data),
    text: `Manual Review Required\n\nTransaction ID: ${data.transactionId}\nCustomer: ${data.customerId}\nAmount: ${data.amount} ${data.currency}\nMerchant: ${data.merchantId}\nRisk Score: ${data.riskScore}/100\nDecision: FLAGGED\nReason: ${data.decisionReason}\n\nAction required: https://fraud-dashboard.example.com/review/${data.transactionId}`,
  };
}

function renderFlaggedCustomerEmail(data) {
  const content = renderCustomerDecisionEmail({
    accentColor: '#946200',
    eyebrow: 'Security Hold',
    title: 'Transaction On Hold For Review',
    intro: 'We paused a recent transaction because it needs a quick manual review before we can complete it.',
    decisionSummary: data.decisionReason,
    nextSteps: 'No action is required right now. You can monitor the transaction in the banking portal, and if the final decision is not what you expected you can submit an appeal there.',
    data,
  });

  return {
    subject: `Transaction Under Review - Reference ${data.referenceId}`,
    html: content.html,
    text: content.text,
  };
}

function renderApprovedCustomerEmail(data) {
  const content = renderCustomerDecisionEmail({
    accentColor: '#156f4a',
    eyebrow: 'Transaction Update',
    title: 'Transaction Approved',
    intro: 'Your transaction has been approved and is now moving through the normal processing flow.',
    decisionSummary: 'Our controls have cleared this payment for processing.',
    nextSteps: 'No further action is needed if this payment was expected. If you do not recognise it, contact the fraud team immediately using the details below.',
    data,
  });

  return {
    subject: `Transaction Approved - Reference ${data.referenceId}`,
    html: content.html,
    text: content.text,
  };
}

module.exports = {
  renderApprovedCustomerEmail,
  renderDeclinedCustomerEmail,
  renderDeclinedFraudTeamEmail,
  renderFlaggedCustomerEmail,
  renderFlaggedFraudTeamEmail,
};
