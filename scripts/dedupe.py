#!/usr/bin/env python3
"""
Fuzzy de-duplication backstop for the no-repeat-ideas requirement.

Given a list of candidate idea titles and the channel's memory file, flags candidates
that are too similar to something already produced. Code-side backstop so we don't rely
solely on the LLM to remember.

Usage:
    python dedupe.py <memory_file.jsonl> <candidates.json> [--threshold 0.82]

candidates.json: JSON array of objects each with a "title" key.
memory_file.jsonl: one JSON object per line, each with a "title" key.

Output (stdout): JSON { "unique": [...], "duplicates": [{"title":.., "matched":..,
"score":..}] }
"""

import sys
import json
import argparse
import re
from difflib import SequenceMatcher


def norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9 ]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, norm(a), norm(b)).ratio()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("memory_file")
    ap.add_argument("candidates_json")
    ap.add_argument("--threshold", type=float, default=0.82)
    args = ap.parse_args()

    past = []
    try:
        with open(args.memory_file) as f:
            for line in f:
                line = line.strip()
                if line:
                    past.append(json.loads(line).get("title", ""))
    except FileNotFoundError:
        past = []

    with open(args.candidates_json) as f:
        candidates = json.load(f)

    unique, duplicates = [], []
    for c in candidates:
        title = c.get("title", "")
        best_score, best_match = 0.0, None
        for p in past:
            sc = similarity(title, p)
            if sc > best_score:
                best_score, best_match = sc, p
        if best_score >= args.threshold:
            duplicates.append({"title": title, "matched": best_match, "score": round(best_score, 3)})
        else:
            unique.append(c)

    print(json.dumps({"unique": unique, "duplicates": duplicates}, indent=2))


if __name__ == "__main__":
    main()
