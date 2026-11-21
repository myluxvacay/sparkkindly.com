#!/usr/bin/env python3
"""Sample client for the SparkKindly Content Push API (docs/content-push-api.md).

Standard library only. Configuration is by environment variable:

  SPARKKINDLY_BASE          e.g. https://staging.sparkkindly.com  (default: staging)
  SPARKKINDLY_KEY           a submitter ('content' role) key
  SPARKKINDLY_REVIEWER_KEY  a reviewer key   (only for the review command)
  SPARKKINDLY_PROMOTER_KEY  a promoter key   (only for the publish command)

Usage:
  push_client.py submit package.json [hero.png]   submit a package, then attach the hero image
  push_client.py status ITEM_ID                   print an item's status (and its video, if any)
  push_client.py queue [STATUS]                   list push items, optionally filtered by status
  push_client.py review ITEM_ID approve           approve (reviewer key)
  push_client.py review ITEM_ID reject "reason"   reject with a reason (reviewer key)
  push_client.py publish ITEM_ID                  publish an approved item (promoter key)

A package is one JSON file: { "article": {...}, "quizzes": [...], "video": {...} } in the repo's
library shapes. Resubmitting the same package is safe: identical content returns the existing
records (idempotency by content fingerprint), never duplicates.
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("SPARKKINDLY_BASE", "https://staging.sparkkindly.com").rstrip("/")


def call(method, path, key, body=None, raw=None, content_type="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("X-Agent-Key", key)
    if data is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def need(var):
    key = os.environ.get(var)
    if not key:
        sys.exit(f"set {var} first")
    return key


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    cmd = argv[1]

    if cmd == "submit":
        key = need("SPARKKINDLY_KEY")
        package = json.load(open(argv[2]))
        status, out = call("POST", "/api/agent/content", key, body=package)
        print(f"submit -> HTTP {status}")
        print(json.dumps(out, indent=2))
        if status in (200, 201) and len(argv) > 3:
            item_id = out["items"][0]["id"]
            image = open(argv[3], "rb").read()
            kind = "image/png" if argv[3].endswith(".png") else "image/jpeg"
            s2, out2 = call("POST", f"/api/agent/content/{item_id}/image", key, raw=image, content_type=kind)
            print(f"image -> HTTP {s2}")
            print(json.dumps(out2, indent=2))

    elif cmd == "status":
        status, out = call("GET", f"/api/agent/content/{argv[2]}", need("SPARKKINDLY_KEY"))
        print(f"HTTP {status}")
        print(json.dumps(out, indent=2))

    elif cmd == "queue":
        path = "/api/agent/content" + (f"?status={argv[2]}" if len(argv) > 2 else "")
        status, out = call("GET", path, need("SPARKKINDLY_KEY"))
        print(f"HTTP {status}")
        print(json.dumps(out, indent=2))

    elif cmd == "review":
        body = {"decision": argv[3]}
        if argv[3] == "reject":
            body["reason"] = argv[4]
        status, out = call("POST", f"/api/agent/content/{argv[2]}/review", need("SPARKKINDLY_REVIEWER_KEY"), body=body)
        print(f"HTTP {status}")
        print(json.dumps(out, indent=2))

    elif cmd == "publish":
        status, out = call("POST", f"/api/agent/content/{argv[2]}/publish", need("SPARKKINDLY_PROMOTER_KEY"), body={})
        print(f"HTTP {status}")
        print(json.dumps(out, indent=2))

    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
