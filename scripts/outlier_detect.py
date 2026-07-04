#!/usr/bin/env python3
"""
Deterministic outlier detection from YouTube video data.

WHY THIS EXISTS: outlier detection is arithmetic (baseline + multiplier). LLMs are
unreliable at arithmetic over lists of numbers, so we compute outliers HERE in code
and hand the clean result to Perplexity/Opus for the qualitative work. Never ask an
LLM to "find videos with 3x the average views" - do it here.

Usage:
    python outlier_detect.py <channel_data.json> [--multiplier 3.0] [--baseline median] [--min-age-days 21]

Input: JSON produced by fetch_channel_data.py (must contain "recent_videos" with
       "title", "published_at", "view_count").

Output (stdout): JSON {
  "baseline": <int>,               # channel view baseline
  "baseline_method": "median",
  "multiplier_threshold": 3.0,
  "mature_video_count": <int>,     # videos old enough to judge
  "outliers": [
    {"title": ..., "view_count": ..., "multiplier": 5.2, "published_at": ...},
    ...
  ]  # sorted by multiplier desc
}

NOTE ON MATURITY: brand-new videos are still accumulating views, so a low view count
on a 3-day-old video is NOT underperformance. We exclude videos younger than
--min-age-days from BOTH the baseline calculation and the outlier list, so the
baseline is fair and we never mislabel a fresh upload.
"""

import sys
import json
import argparse
import statistics
from datetime import datetime, timezone


def parse_date(s: str) -> datetime:
    # YouTube returns e.g. 2026-06-14T09:00:00Z
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def detect_outliers(videos, multiplier=3.0, baseline_method="median", min_age_days=21):
    now = datetime.now(timezone.utc)

    mature = []
    for v in videos:
        age_days = (now - parse_date(v["published_at"])).days
        if age_days >= min_age_days:
            mature.append(v)

    if not mature:
        return {
            "baseline": 0,
            "baseline_method": baseline_method,
            "multiplier_threshold": multiplier,
            "mature_video_count": 0,
            "outliers": [],
            "warning": f"No videos older than {min_age_days} days to build a baseline from.",
        }

    view_counts = [v["view_count"] for v in mature]
    if baseline_method == "mean":
        baseline = statistics.mean(view_counts)
    else:
        baseline = statistics.median(view_counts)
    baseline = max(baseline, 1)  # avoid div-by-zero

    outliers = []
    for v in mature:
        mult = round(v["view_count"] / baseline, 2)
        if mult >= multiplier:
            outliers.append({
                "title": v["title"],
                "view_count": v["view_count"],
                "multiplier": mult,
                "published_at": v["published_at"],
            })

    outliers.sort(key=lambda x: x["multiplier"], reverse=True)

    return {
        "baseline": int(baseline),
        "baseline_method": baseline_method,
        "multiplier_threshold": multiplier,
        "mature_video_count": len(mature),
        "outliers": outliers,
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("channel_data_json")
    ap.add_argument("--multiplier", type=float, default=3.0)
    ap.add_argument("--baseline", default="median", choices=["median", "mean"])
    ap.add_argument("--min-age-days", type=int, default=21)
    args = ap.parse_args()

    with open(args.channel_data_json) as f:
        data = json.load(f)

    result = detect_outliers(
        data.get("recent_videos", []),
        multiplier=args.multiplier,
        baseline_method=args.baseline,
        min_age_days=args.min_age_days,
    )
    print(json.dumps(result, indent=2))
