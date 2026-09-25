# QA agent: Playwright MCP against the mock recharge UI

Drives a real browser through the 3-page recharge flow (`ui/recharge_app.py`) using the Playwright MCP server, checks
the result against the billing API, and saves screenshot evidence to `tests_qa/evidence/`.

```
mcp_client.py       async wrapper over the MCP tools (navigate, fill, click, select, wait_for, read_text, screenshot)
scenarios.py        the five scenarios as data (also the schema the Test-Gen agent produces)
run_agent_tests.py  executes a scenario: preflight, live pre-balance, steps, assertion, API cross-check, evidence
test_qa_unit.py     35 offline tests (fake browser); no Node, no services
test_scenarios_e2e.py   the five scenarios in a real browser (skipped when services are not running)
```

## Run

```powershell
# terminal 1
.venv\Scripts\python -m uvicorn mock_api.main:app --port 8000
# terminal 2
.venv\Scripts\python -m streamlit run ui/recharge_app.py --server.port 8501
# terminal 3 (needs Node.js 18+; the MCP server is fetched on first use via npx)
$env:PYTHONPATH = "."
python -m tests_qa.run_agent_tests                     # the five hand-written scenarios (deterministic)
python -m tests_qa.run_agent_tests --generate          # the Test-Gen agent writes the steps from plain English
python -m tests_qa.run_agent_tests --headed valid_recharge_e2e     # watch one run
pytest tests_qa                                        # unit tests + (if services are up) the e2e tests
```

From the chat graph: a request such as *"Verify that recharging 199 for 9876543210 updates the balance"* is routed to
the Test-Gen agent, which writes a scenario, runs it here, and answers with the verdict and evidence path.

## Design notes

- **Selectors.** Playwright MCP tools take a `target` that is a snapshot ref or a unique CSS selector (verified against
  `@playwright/mcp` 0.0.82; the architecture doc's `selector`-based mapping is out of date). Streamlit exposes every
  keyed widget's container as `.st-key-<key>`, so the UI gives each element a `key` and scenarios use e.g.
  `.st-key-continue_btn button`, never Streamlit's generated ids.
- **Text assertions** come from `browser_snapshot(target=<selector>)`, the accessibility snapshot of one subtree, not
  screenshots.
- **No hardcoded balances.** Expected values use `{pre_balance+N}`, filled from `GET /balance` before the run, so the
  scenarios work on any database state and can be re-run indefinitely. Nothing resets the database.
- **Failures are results, not crashes.** A missing element reports `selector not found: <selector>` with a failure
  screenshot; unreachable services report how to start them.
- **Cross-system check.** `receipt_balance_matches_api` and `back_nav_no_double_charge` also compare the API's
  balance afterwards, which is what catches a double charge.

## What was verified

- All five scenarios pass in a real browser (~80 s), and via `--generate` with a local `llama3.1:8b` writing the steps.
- **Mutation check:** with the UI deliberately broken, the scenarios fail with precise messages: a confirmation page
  showing the amount + 1 (`Expected '599.00' in 'Amount: 600.00'`) and a Confirm that charges twice (`Expected '740.50'
  in 'New balance: 839.50'`; the Back-navigation scenario also failed).

## Limits

- LLM-generated scenarios can check what the schema lets them express. The schema has no API-check field, so a
  generated scenario checks the receipt but not the API balance; the hand-written scenarios do both.
- Scenarios mutate real rows in the mock database (each recharge adds to the balance). Re-run
  `python -m mock_api.seed` to reset it.
- A small local model produced valid scenarios in every attempt seen (7 of 7), which is a small sample, not a guarantee.
