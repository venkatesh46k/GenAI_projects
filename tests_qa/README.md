# QA agent: Playwright MCP against the React console

Drives a real browser through the console's recharge flow (sign in, open a customer, Recharge dialog: details, review,
receipt) using the Playwright MCP server, checks the result against the billing API, and saves screenshot evidence to
`tests_qa/evidence/`.

```
mcp_client.py       async wrapper over the MCP tools (navigate, fill, click, select, wait_for, read_text, screenshot)
scenarios.py        the five scenarios as data (also the schema the Test-Gen agent produces)
run_agent_tests.py  executes a scenario: preflight, live pre-balance, steps, assertion, API cross-check, evidence
test_qa_unit.py     35 offline tests (fake browser); no Node, no services
test_scenarios_e2e.py   the five scenarios in a real browser (skipped when services are not running)
```

## Run

```powershell
# once: build the front end (restart the server after every rebuild: it lists the built files at startup)
cd web; npm run build
# terminal 1: billing API on :8000 and the console on :8080
cd services/billing; npm run seed; npm run serve
# terminal 2 (needs Node.js 18+; the MCP server is fetched on first use via npx)
$env:PYTHONPATH = "."
python -m tests_qa.run_agent_tests                     # the five hand-written scenarios (deterministic)
python -m tests_qa.run_agent_tests --generate          # the Test-Gen agent writes the steps from plain English
python -m tests_qa.run_agent_tests --headed valid_recharge_e2e     # watch one run
pytest tests_qa                                        # offline unit tests (the e2e tests are opt-in)
$env:RUN_E2E = "1"; pytest tests_qa                   # also the e2e tests: they recharge real rows, so use a demo database
```

From the chat graph: a request such as *"Verify that recharging 199 for 9876543210 updates the balance"* is routed to
the Test-Gen agent, which writes a scenario, runs it here, and answers with the verdict and evidence path.

## Design notes

- **Selectors.** Playwright MCP tools take a `target` that is a snapshot ref or a unique CSS selector (verified against
  `@playwright/mcp` 0.0.82; the architecture doc's `selector`-based mapping is out of date). The console gives every
  element a test needs a `data-testid`, and scenarios use e.g. `[data-testid="recharge-continue"]`, never class names
  or generated ids, so restyling the UI cannot break them.
- **Signed out every time.** Each run gets a fresh isolated browser, so every scenario opens the customer page, signs in
  with the demo login (which returns to that page) and then opens the Recharge dialog. Typing never submits: like a
  user, the scenario clicks the button.
- **Text assertions** come from `browser_snapshot(target=<selector>)`, the accessibility snapshot of one subtree, not
  screenshots.
- **No hardcoded balances.** Expected values use `{pre_balance+N}`, filled from `GET /balance` before the run, so the
  scenarios work on any database state and can be re-run indefinitely. Nothing resets the database.
- **Failures are results, not crashes.** A missing element reports `selector not found: <selector>` with a failure
  screenshot; unreachable services report how to start them.
- **Cross-system check.** `receipt_balance_matches_api` and `back_nav_no_double_charge` also compare the API's
  balance afterwards, which is what catches a double charge.

## What was verified

- Against the React console (Phase 9): all five scenarios pass in a real browser, two LLM-written scenarios pass with
  `--generate`, and a chat request to the Copilot ran a scenario and returned the verdict with its screenshot. With the
  review step deliberately showing amount + 1 the scenario failed with `Expected '599.00' in '₹600.00'`.

Earlier, against the Streamlit recharge app:

- All five scenarios pass in a real browser (~80 s), and via `--generate` with a local `llama3.1:8b` writing the steps.
- **Mutation check:** with the UI deliberately broken, the scenarios fail with precise messages: a confirmation page
  showing the amount + 1 (`Expected '599.00' in 'Amount: 600.00'`) and a Confirm that charges twice (`Expected '740.50'
  in 'New balance: 839.50'`; the Back-navigation scenario also failed).

## Limits

- LLM-generated scenarios can check what the schema lets them express. The schema has no API-check field, so a
  generated scenario checks the receipt but not the API balance; the hand-written scenarios do both.
- Scenarios mutate real rows (each recharge adds to the balance). Re-run `npm run seed` in `services/billing` to
  reset the database. Amounts are compared without thousands separators, so a balance past 1,000 still matches.
- A small local model produced valid scenarios in every attempt seen (7 of 7), which is a small sample, not a guarantee.
