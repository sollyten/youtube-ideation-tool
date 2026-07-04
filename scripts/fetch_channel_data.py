#!/usr/bin/env python3
"""
Fetch channel stats + recent video titles/view counts from the YouTube Data API v3.

Usage:
    python fetch_channel_data.py <channel_url_or_handle>

Requires env var YOUTUBE_API_KEY (free tier: console.cloud.google.com ->
enable "YouTube Data API v3" -> create API key. Free quota is 10,000 units/day,
this script uses roughly 3-5 units per run).

Prints JSON to stdout: {
  "channel_title": ...,
  "subscriber_count": ...,
  "view_count": ...,
  "video_count": ...,
  "recent_videos": [{"title": ..., "published_at": ..., "view_count": ...}, ...]
}
"""

import os
import re
import sys
import json
import urllib.request
import urllib.parse

API_KEY = os.environ.get("YOUTUBE_API_KEY")
BASE = "https://www.googleapis.com/youtube/v3"


def _get(endpoint, params):
    params = {**params, "key": API_KEY}
    url = f"{BASE}/{endpoint}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read().decode())


def resolve_channel_id(url_or_handle):
    """Handle formats: @handle, /channel/UC..., /c/name, /user/name, or bare handle."""
    handle_match = re.search(r"@([\w\-]+)", url_or_handle)
    channel_id_match = re.search(r"channel/(UC[\w\-]+)", url_or_handle)

    if channel_id_match:
        return channel_id_match.group(1)

    handle = handle_match.group(1) if handle_match else url_or_handle.strip().lstrip("@")

    data = _get("channels", {"part": "id", "forHandle": handle})
    items = data.get("items", [])
    if not items:
        # fallback: search
        search = _get("search", {"part": "snippet", "q": handle, "type": "channel", "maxResults": 1})
        s_items = search.get("items", [])
        if not s_items:
            raise ValueError(f"Could not resolve channel for: {url_or_handle}")
        return s_items[0]["snippet"]["channelId"]
    return items[0]["id"]


def fetch_channel_data(url_or_handle):
    if not API_KEY:
        raise EnvironmentError("YOUTUBE_API_KEY not set")

    channel_id = resolve_channel_id(url_or_handle)

    ch = _get("channels", {"part": "snippet,statistics,contentDetails", "id": channel_id})
    item = ch["items"][0]
    stats = item["statistics"]
    uploads_playlist = item["contentDetails"]["relatedPlaylists"]["uploads"]

    playlist_data = _get("playlistItems", {
        "part": "snippet",
        "playlistId": uploads_playlist,
        "maxResults": 50,  # max per call; wider baseline = more reliable outlier detection
    })

    video_ids = [v["snippet"]["resourceId"]["videoId"] for v in playlist_data.get("items", [])]
    recent_videos = []
    if video_ids:
        vids = _get("videos", {"part": "snippet,statistics", "id": ",".join(video_ids)})
        for v in vids.get("items", []):
            vid = v["id"]
            recent_videos.append({
                "video_id": vid,
                "url": f"https://www.youtube.com/watch?v={vid}",
                "title": v["snippet"]["title"],
                "published_at": v["snippet"]["publishedAt"],
                "view_count": int(v["statistics"].get("viewCount", 0)),
            })

    return {
        "channel_title": item["snippet"]["title"],
        "channel_id": channel_id,
        "subscriber_count": int(stats.get("subscriberCount", 0)),
        "view_count": int(stats.get("viewCount", 0)),
        "video_count": int(stats.get("videoCount", 0)),
        "recent_videos": recent_videos,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: fetch_channel_data.py <channel_url_or_handle>", file=sys.stderr)
        sys.exit(1)
    try:
        result = fetch_channel_data(sys.argv[1])
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
