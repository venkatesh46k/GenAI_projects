"""Evaluation questions with hand-written reference answers, taken from the docs in data/docs/.

`in_scope=False` questions have no answer in the knowledge base: the correct behaviour is to say so.
"""

QUESTIONS = [
    # --- answerable from the knowledge base ---
    {
        "query": "How many days is the Premium 599 plan valid and how much data per day does it give?",
        "expected_output": "The Premium 599 plan is valid for 56 days and gives 2.5 GB of data per day.",
    },
    {
        "query": "What benefits does the Basic 199 plan include?",
        "expected_output": "The Basic 199 plan gives 28 days validity, 1.5 GB of data per day, 1000 voice minutes "
        "for the validity period and 100 SMS per day.",
    },
    {
        "query": "Can I buy a data top-up pack without an active base plan?",
        "expected_output": "A top-up needs an active base plan such as PLAN_199 or PLAN_599. Buying it on an expired "
        "line only credits the balance, and the data is not usable until a base plan is active.",
    },
    {
        "query": "What is the grace period after my plan expires?",
        "expected_output": "The grace period is 15 days after expiry. Incoming calls and SMS continue, while outgoing "
        "calls, outgoing SMS and data are blocked.",
    },
    {
        "query": "At what balance are outgoing calls barred?",
        "expected_output": "Below 5 rupees, outgoing calls and out-of-bundle usage are barred. Recharging removes the "
        "barring immediately.",
    },
    {
        "query": "Are incoming calls free while roaming in India?",
        "expected_output": "Yes, incoming calls are free on domestic roaming for all plans with active validity.",
    },
    {
        "query": "How long does a refund to my payment source take?",
        "expected_output": "A refund to the original payment source is made within 7 working days after approval.",
    },
    {
        "query": "How is the charge in a CDR calculated?",
        "expected_output": "The rating engine checks the plan allowance for the call type. Usage inside the bundle is "
        "rated at zero, and usage beyond it is rated at the out-of-bundle tariff and stored in the charge "
        "field. Voice is rated per started minute.",
    },
    {
        "query": "How long does it take to resolve a billing dispute on a standard plan?",
        # Tightened after the first full run: the question asks for the resolution time, so the reference no
        # longer also demands the 24-hour first-response time (an over-specified reference, not a bad answer).
        "expected_output": "For standard plans the resolution target for a billing dispute is 7 working days.",
    },
    {
        "query": "When does a dispute get escalated to a human specialist?",
        "expected_output": "A dispute is escalated when confidence in automatic resolution is below 50 percent, the "
        "amount is above 500 rupees, the subscriber asks for a manager or supervisor or to file a complaint, "
        "there are three or more disputes in 30 days, or the evidence is contradictory or missing.",
    },
    {
        "query": "What do TRAI regulations say about prepaid plan validity?",
        "expected_output": "Validity is counted from the date of recharge, operators must offer at least one plan "
        "voucher with 30 days validity, and plan vouchers with validity up to 365 days are offered.",
    },
    {
        "query": "My recharge was debited but the balance did not change. What should I do?",
        "expected_output": "Wait a short time and check the balance again. If it is still not credited, raise a "
        "dispute. Money that was debited but not credited is reversed within 7 working days.",
    },
    # --- not in the knowledge base: the right answer is to say so ---
    {
        "query": "Do you offer international roaming rates for the US?",
        "expected_output": "The assistant does not have international roaming rates. International roaming needs a "
        "separate activation, and the subscriber should contact customer care.",
        "in_scope": False,
    },
    {
        "query": "What is the price of your 3-month prepaid plan?",
        "expected_output": "I don't have that information.",
        "in_scope": False,
    },
    {
        "query": "Who is the CEO of the company?",
        "expected_output": "I don't have that information.",
        "in_scope": False,
    },
]
