#!/usr/bin/env python3
"""
Per-channel YouTube Analytics fetch (OAuth 2.0).

CRITICAL DESIGN POINT: this is DIFFERENT from fetch_channel_data.py.
- fetch_channel_data.py uses a single public API KEY to read PUBLIC data (titles, view
  counts) for ANY channel, including competitors.
- THIS script reads PRIVATE owner-only analytics (retention, impressions, CTR, average
  view duration) and therefore needs OAuth authorization FROM THE CHANNEL OWNER.

Because each channel is a different YouTube account, EACH PROFILE STORES ITS OWN OAUTH
CREDENTIALS. Atrium and MrSpherical authorize separately and their tokens never mix.
Tokens are stored per profile at: connections/<slug>.token.json (git-ignored).

This means the Performance Tracker tab stays LOCKED for a profile until that profile has
completed its own YouTube authorization.

Usage:
    python fetch_analytics.py <slug> --recent 10
    python fetch_analytics.py <slug> --video <video_id> --retention

Requires per-profile OAuth. First run triggers the consent flow and writes
connections/<slug>.token.json. Requires a Google Cloud OAuth client (Desktop app type)
with the YouTube Analytics API + YouTube Data API enabled; put the client secrets at
connections/oauth_client.json (shared across profiles, this is just the app identity;
the per-profile TOKEN is what differs).

Scopes needed:
  https://www.googleapis.com/auth/yt-analytics.readonly
  https://www.googleapis.com/auth/youtube.readonly

Outputs JSON to stdout. This file is a working reference implementation; the web app
backend can port the same calls. Install deps:
  pip install google-auth google-auth-oauthlib google-api-python-client --break-system-packages
"""

import os
import sys
import json
import argparse
from datetime import date, timedelta

CONN_DIR = os.path.join(os.path.dirname(__file__), "..", "connections")
SCOPES = [
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/youtube.readonly",
]


def get_services(slug, token_dir=None):
    """Load or create per-profile OAuth credentials, return (analytics, data) services.

    HOSTED MULTI-USER: the backend passes a USER-SCOPED token_dir (e.g. one directory per
    owner_user_id) so no two directors' tokens ever share a namespace. In the hosted
    product the token is decrypted from the channel_tokens table into this dir at call
    time and wiped after, rather than persisted as a plaintext file. token_dir defaults to
    the shared CONN_DIR only for local/dev single-user use.
    """
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    conn_dir = token_dir or CONN_DIR
    os.makedirs(conn_dir, exist_ok=True)
    token_path = os.path.join(conn_dir, f"{slug}.token.json")
    client_path = os.path.join(CONN_DIR, "oauth_client.json")

    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(client_path, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())

    analytics = build("youtubeAnalytics", "v2", credentials=creds)
    data = build("youtube", "v3", credentials=creds)
    return analytics, data


def recent_video_performance(analytics, data, n=10):
    """Video-level performance for the authorized channel's recent uploads."""
    start = (date.today() - timedelta(days=365)).isoformat()
    end = date.today().isoformat()

    report = analytics.reports().query(
        ids="channel==MINE",
        startDate=start,
        endDate=end,
        metrics="views,estimatedMinutesWatched,averageViewPercentage,averageViewDuration,subscribersGained",
        dimensions="video",
        maxResults=n,
        sort="-views",
    ).execute()

    rows = report.get("rows", [])
    headers = [h["name"] for h in report.get("columnHeaders", [])]

    # Compute a Studio-style "N out of 10" rank ourselves from averageViewPercentage,
    # since that relative indicator is a Studio UI construct, not a raw API field.
    videos = [dict(zip(headers, r)) for r in rows]
    if videos:
        avp_sorted = sorted(videos, key=lambda v: v.get("averageViewPercentage", 0), reverse=True)
        for i, v in enumerate(avp_sorted):
            v["performance_rank"] = f"{i+1} of {len(avp_sorted)}"
    return videos


def audience_retention(analytics, video_id):
    """Second-by-second (ratio-by-ratio) retention for one owned video."""
    report = analytics.reports().query(
        ids="channel==MINE",
        startDate=(date.today() - timedelta(days=365)).isoformat(),
        endDate=date.today().isoformat(),
        metrics="audienceWatchRatio,relativeRetentionPerformance",
        dimensions="elapsedVideoTimeRatio",
        filters=f"video=={video_id}",
    ).execute()
    headers = [h["name"] for h in report.get("columnHeaders", [])]
    return [dict(zip(headers, r)) for r in report.get("rows", [])]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--recent", type=int, default=0)
    ap.add_argument("--video")
    ap.add_argument("--retention", action="store_true")
    ap.add_argument("--token-dir", default=None,
                    help="User-scoped token directory (hosted multi-user). Defaults to shared dir for local dev.")
    args = ap.parse_args()

    try:
        analytics, data = get_services(args.slug, token_dir=args.token_dir)
        if args.retention and args.video:
            print(json.dumps(audience_retention(analytics, args.video), indent=2))
        else:
            n = args.recent or 10
            print(json.dumps(recent_video_performance(analytics, data, n), indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e),
                          "hint": "Ensure connections/oauth_client.json exists and this "
                                  "profile has authorized. Performance tab stays locked "
                                  "until authorization completes."}), file=sys.stderr)
        sys.exit(1)
