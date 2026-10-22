#!/usr/bin/env python3
"""Website stats (GA4 + Search Console, last 28d). Writes ONLY data/<slug>/web.json, aggregates only.
Auth: reuses seo-api creds(); key path from GOOGLE_APPLICATION_CREDENTIALS (set outside the repo)."""
import json, os, sys
sys.path.insert(0, os.environ.get("SEO_API_DIR", "/workspace/seo-api"))
from report import creds, rng, err
from google.auth.transport.requests import AuthorizedSession
from googleapiclient.discovery import build
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import RunReportRequest, DateRange, Metric, Dimension, OrderBy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES = [
    {"slug": "chezerecta", "domain": "djchezerecta.com", "ga4": "558598980"},
    {"slug": "morntide", "domain": "morntidemusic.com", "ga4_name": "Morntide Music Website", "ga4_fallback": "558780885"},
    {"slug": "flbh", "domain": "flboatinghub.com", "ga4": "546216215"},
]

def find_property(c, name):
    s = AuthorizedSession(c); r = s.get("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200")
    if r.status_code != 200: raise RuntimeError(f"Admin API {r.status_code}: {r.json().get('error', {}).get('message', '')[:120]}")
    for a in r.json().get("accountSummaries", []):
        for p in a.get("propertySummaries", []):
            if p.get("displayName") == name: return p["property"].split("/")[1]
    return None

def ga(cl, prop, metrics, dims=(), limit=10, order=None):
    s, e = rng(28)
    r = cl.run_report(RunReportRequest(property=f"properties/{prop}", date_ranges=[DateRange(start_date=s, end_date=e)],
        metrics=[Metric(name=m) for m in metrics], dimensions=[Dimension(name=d) for d in dims], limit=limit,
        order_bys=[order] if order else []))
    return [[v.value for v in row.dimension_values] + [float(v.value) for v in row.metric_values] for row in r.rows]

def ga_block(cl, prop):
    m = ["activeUsers", "sessions", "screenPageViews"]
    t = ga(cl, prop, m); t = t[0] if t else [0, 0, 0]
    daily = ga(cl, prop, m, ("date",), 100, OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name="date")))
    by = lambda n: OrderBy(metric=OrderBy.MetricOrderBy(metric_name=n), desc=True)
    return {"users": int(t[0]), "sessions": int(t[1]), "pageviews": int(t[2]),
            "daily": [{"day": f"{d[:4]}-{d[4:6]}-{d[6:]}", "users": int(u), "sessions": int(s), "pageviews": int(p)} for d, u, s, p in daily],
            "top_pages": [{"page": p, "views": int(v), "users": int(u)} for p, v, u in ga(cl, prop, ["screenPageViews", "activeUsers"], ("pagePath",), 10, by("screenPageViews"))],
            "sources": [{"channel": ch, "sessions": int(s)} for ch, s in ga(cl, prop, ["sessions"], ("sessionDefaultChannelGroup",), 10, by("sessions"))]}

def gsc_block(sc, domain):
    sites = {x["siteUrl"] for x in sc.sites().list().execute().get("siteEntry", [])}
    prop = next((p for p in (f"sc-domain:{domain}", f"https://{domain}/", f"https://www.{domain}/") if p in sites), None)
    if not prop: return {"error": "no Search Console property accessible"}
    s, e = rng(28); q = lambda b: sc.searchanalytics().query(siteUrl=prop, body={"startDate": s, "endDate": e, **b}).execute().get("rows", [])
    t = (q({}) or [{}])[0]
    return {"property": prop, "clicks": int(t.get("clicks", 0)), "impressions": int(t.get("impressions", 0)),
            "top_queries": [{"query": r["keys"][0], "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "position": round(r["position"], 1)}
                            for r in q({"dimensions": ["query"], "rowLimit": 10})]}

def main():
    c = creds(); cl = BetaAnalyticsDataClient(credentials=c); sc = build("searchconsole", "v1", credentials=c, cache_discovery=False)
    s, e = rng(28)
    for site in SITES:
        out = {"domain": site["domain"], "range": {"start": s, "end": e}}
        prop = site.get("ga4")
        if not prop:
            try: prop = find_property(c, site["ga4_name"])
            except Exception as x: out["ga4_note"] = "lookup failed: " + str(x)
            if not prop and site.get("ga4_fallback"):
                prop = site["ga4_fallback"]; out["ga4_note"] = out.get("ga4_note", "") + f"; using seo-api configured ID {prop} (name not verified)"
        out["ga4_property"] = prop
        if prop:
            try: out["ga4"] = ga_block(cl, prop)
            except Exception as x: out["ga4_error"] = err(x)
        else: out["ga4_error"] = f"property '{site['ga4_name']}' not in account summaries"
        try: out["gsc"] = gsc_block(sc, site["domain"])
        except Exception as x: out["gsc"] = {"error": err(x)}
        path = os.path.join(ROOT, "data", site["slug"], "web.json"); os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(out, open(path, "w"), indent=1); print("wrote", os.path.relpath(path, ROOT))

if __name__ == "__main__": main()
