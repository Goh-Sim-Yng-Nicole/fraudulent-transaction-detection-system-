## Postman User Scenarios

Import both files into Postman:

- `ftds-user-scenarios.postman_collection.json`
- `ftds-local.postman_environment.json`

Run them in this order:

1. `Bootstrap`
2. `Scenario 1 - Fraudulent Transaction Rejected`
3. `Scenario 2 - Risky Transaction Flagged Then Reviewed`
4. `Scenario 3 - Declined Transaction Then Appeal Reversal`

Notes:

- The collection stores customer and analyst tokens into collection variables automatically.
- After register/login OTP requests, the same OTP is emailed to the customer and mirrored into Mailpit. For demos, copy the OTP from Mailpit into `otpCode`.
- Scenario 3 assumes the customer already has at least one declined or flagged transaction, which the collection creates earlier in the run.
