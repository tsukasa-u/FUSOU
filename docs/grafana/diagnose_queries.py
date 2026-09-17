#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
import urllib.error

def main():
    dashboard_path = os.path.join(os.path.dirname(__file__), "cloudflare-unified-dashboard.json")
    if not os.path.exists(dashboard_path):
        print(f"Error: {dashboard_path} not found.")
        sys.exit(1)

    with open(dashboard_path, "r", encoding="utf-8") as f:
        dash = json.load(f)

    # Get API Token from args or env
    api_token = None
    if len(sys.argv) > 1:
        api_token = sys.argv[1]
    else:
        api_token = os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")

    account_tag = os.environ.get("CLOUDFLARE_ACCOUNT_TAG", "YOUR_CLOUDFLARE_ACCOUNT_TAG")
    from_date = "2026-08-18"
    to_date = "2026-09-17"

    print("=" * 80)
    print("Cloudflare Dashboard Queries Diagnostic Tool")
    print("=" * 80)
    print(f"Account Tag: {account_tag}")
    print(f"Date Range : {from_date} ~ {to_date}")
    if api_token:
        print("API Token  : [PROVIDED]")
    else:
        print("API Token  : [NOT PROVIDED - Inspection Mode Only]")
        print("Usage to execute live test: python docs/grafana/diagnose_queries.py <YOUR_CF_API_TOKEN>")
    print("=" * 80)

    # Extract unique queries
    seen_queries = {}
    for p in dash.get("panels", []):
        ptype = p.get("type")
        title = p.get("title", "Untitled")
        for t in p.get("targets", []):
            raw_q = t.get("url_options", {}).get("data", "")
            if raw_q:
                # Interpolate variables
                resolved_q = raw_q.replace("${accountTag}", account_tag)
                resolved_q = resolved_q.replace("${__from:date:YYYY-MM-DD}", from_date)
                resolved_q = resolved_q.replace("${__to:date:YYYY-MM-DD}", to_date)
                root_sel = t.get("root_selector", "")
                key = resolved_q.strip()
                if key not in seen_queries:
                    seen_queries[key] = {
                        "panels": [],
                        "root": root_sel,
                        "query": resolved_q
                    }
                seen_queries[key]["panels"].append(f"[{ptype}] {title}")

    print(f'Found {len(seen_queries)} unique GraphQL queries across {len(dash.get("panels", []))} panels.')


    if not api_token:
        print("List of queries in dashboard:")
        for idx, (q_text, info) in enumerate(seen_queries.items(), 1):
            print(f"[{idx:2d}] Panels: {', '.join(info['panels'][:2])}")
            print(f"     Root: {info['root']}")
            print(f"     Query: {q_text[:90].replace(chr(10), ' ')}...")
            print()
        return

    # Execute queries against Cloudflare GraphQL endpoint
    endpoint = "https://api.cloudflare.com/client/v4/graphql"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    results = []
    for idx, (q_text, info) in enumerate(seen_queries.items(), 1):
        panel_names = ", ".join(info["panels"][:2])
        if len(info["panels"]) > 2:
            panel_names += f" (+{len(info['panels'])-2} more)"

        payload = json.dumps({"query": info["query"]}).encode("utf-8")
        req = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")

        status_str = ""
        detail_str = ""
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8")
                res_json = json.loads(body)
                errors = res_json.get("errors")
                data = res_json.get("data")
                if errors:
                    err_msg = "; ".join([e.get("message", "Unknown error") for e in errors])
                    status_str = "FAIL (GraphQL Error)"
                    detail_str = err_msg
                else:
                    # navigate root selector
                    root_path = info["root"].split(".")
                    cur = data
                    for part in root_path:
                        if part == "data":
                            continue
                        if "[" in part and "]" in part:
                            p_name = part[:part.index("[")]
                            p_idx = int(part[part.index("[")+1:part.index("]")])
                            if isinstance(cur, dict) and p_name in cur:
                                cur = cur[p_name]
                                if isinstance(cur, list) and len(cur) > p_idx:
                                    cur = cur[p_idx]
                                else:
                                    cur = None
                            else:
                                cur = None
                        elif isinstance(cur, dict) and part in cur:
                            cur = cur[part]
                        else:
                            cur = None
                    
                    if isinstance(cur, list):
                        count = len(cur)
                        status_str = "OK" if count > 0 else "OK (Empty 0 records)"
                        detail_str = f"{count} records returned"
                    elif isinstance(cur, dict):
                        status_str = "OK"
                        detail_str = f"object returned: {list(cur.keys())}"
                    else:
                        status_str = "OK (Null/Empty)"
                        detail_str = f"selector '{info['root']}' returned empty"

        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            status_str = f"HTTP {e.code}"
            detail_str = err_body[:100]
        except Exception as ex:
            status_str = "ERROR"
            detail_str = str(ex)

        print(f"[{idx:2d}/{len(seen_queries)}] {status_str:22s} | {panel_names[:45]:45s} | {detail_str}")

if __name__ == "__main__":
    main()
