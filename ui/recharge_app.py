"""Standalone mock recharge app: the target of the Playwright MCP QA agent (tests_qa/).

    streamlit run ui/recharge_app.py --server.port 8501     (the billing API must be running)

The flow itself lives in ui/recharge_flow.py and is shared with the console's Recharge view.
"""
import os
import sys

import streamlit as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))  # so `ui` imports work under `streamlit run`

from ui import recharge_flow  # noqa: E402

st.set_page_config(page_title="Recharge", page_icon="\U0001F4F1")
st.title("Recharge")
recharge_flow.render()
