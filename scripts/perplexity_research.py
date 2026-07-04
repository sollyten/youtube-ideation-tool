#!/usr/bin/env python3
"""
Run a research query against the Perplexity API.

Usage:
    python perplexity_research.py "<prompt text>"

Requires env var PERPLEXITY_API_KEY (from your existing Perplexity account:
perplexity.ai/settings/api).

Uses the "sonar-pro" model by default (good balance of depth vs cost for this).
Swap MODEL below to "sonar-deep-research" for the heaviest research mode if needed.

Prints the response text (with citations if returned) to stdout.
"""

import os
import sys
import json
import urllib.request

API_KEY = os.environ.get("PERPLEXITY_API_KEY")
MODEL = "sonar-pro"
URL = "https://api.perplexity.ai/chat/completions"


def run_research(prompt: str) -> dict:
    if not API_KEY:
        raise EnvironmentError("PERPLEXITY_API_KEY not set")

    body = {
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a research assistant supporting YouTube content strategy. "
                    "Be specific: cite dates, sources, and concrete numbers where "
                    "available. Do not pad with generic filler."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())

    content = data["choices"][0]["message"]["content"]
    citations = data.get("citations", [])
    return {"content": content, "citations": citations}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: perplexity_research.py \"<prompt>\"", file=sys.stderr)
        sys.exit(1)
    try:
        result = run_research(sys.argv[1])
        print(result["content"])
        if result["citations"]:
            print("\n--- Citations ---")
            for c in result["citations"]:
                print(c)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
