#!/usr/bin/env python3
"""Website stats (GA4 + Search Console, last 28d). Writes ONLY data/<slug>/web.json, aggregates only.
Auth: reuses seo-api creds(); key path from GOOGLE_APPLICATION_CREDENTIALS (set outside the repo)."""
import json, os, sys, statistics, urllib.request, urllib.parse, xml.etree.ElementTree as ET
sys.path.insert(0, os.environ.get("SEO_API_DIR", "/workspace/seo-api"))
from report import creds, rng, err
from google.auth.transport.requests import AuthorizedSession
from googleapiclient.discovery import build
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import RunReportRequest, DateRange, Metric, Dimension, OrderBy, FilterExpression, FilterExpressionList, Filter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES = [
    {"slug": "chezerecta", "domain": "djchezerecta.com", "ga4": "558598980", "static": ["/", "/player/", "/releases/", "/playlists/"]},
    {"slug": "morntide", "domain": "morntidemusic.com", "ga4_name": "Morntide Music Website", "ga4_fallback": "558780885", "static": ["/"]},
    {"slug": "flbh", "domain": "flboatinghub.com", "ga4": "546216215", "static": ["/", "/map/"]},
]

def find_property(c, name):
    s = AuthorizedSession(c); r = s.get("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200")
    if r.status_code != 200: raise RuntimeError(f"Admin API {r.status_code}: {r.json().get('error', {}).get('message', '')[:120]}")
    for a in r.json().get("accountSummaries", []):
        for p in a.get("propertySummaries", []):
            if p.get("displayName") == name: return p["property"].split("/")[1]
    return None

def sitemap_paths(domain, url=None, depth=0):
    """Paths listed in the site's sitemap.xml (follows sitemap indexes)."""
    url = url or f"https://{domain}/sitemap.xml"; ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    root = ET.fromstring(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "analytics-desk/1.0"}), timeout=20).read())
    out = set()
    for el in root.iter(f"{ns}loc"):
        if root.tag.endswith("sitemapindex") and depth < 2: out |= sitemap_paths(domain, el.text.strip(), depth + 1)
        else: out.add(urllib.parse.urlparse(el.text.strip()).path or "/")
    return out

def allowlist(site):
    paths = set(site["static"]) | sitemap_paths(site["domain"])
    paths |= {"/es" + p for p in list(paths) if not p.startswith("/es/")}
    return paths | {p.rstrip("/") for p in paths if p != "/"} | {p + "/" for p in paths if not p.endswith("/")}

def real_filter(site, paths):
    """Production hostname only (drops *.pages.dev previews) and pagePath in the sitemap allowlist."""
    f = lambda d, vals: FilterExpression(filter=Filter(field_name=d, in_list_filter=Filter.InListFilter(values=sorted(vals))))
    return FilterExpression(and_group=FilterExpressionList(expressions=[f("hostName", [site["domain"], "www." + site["domain"]]), f("pagePath", paths)]))

def ga(cl, prop, metrics, dims=(), limit=10, order=None, flt=None):
    s, e = rng(28)
    r = cl.run_report(RunReportRequest(property=f"properties/{prop}", date_ranges=[DateRange(start_date=s, end_date=e)],
        metrics=[Metric(name=m) for m in metrics], dimensions=[Dimension(name=d) for d in dims], limit=limit,
        order_bys=[order] if order else [], dimension_filter=flt))
    return [[v.value for v in row.dimension_values] + [float(v.value) for v in row.metric_values] for row in r.rows]

def ga_block(cl, prop, flt=None):
    m = ["activeUsers", "sessions", "screenPageViews"]
    t = ga(cl, prop, m, flt=flt); t = t[0] if t else [0, 0, 0]
    daily = ga(cl, prop, m, ("date",), 100, OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name="date")), flt)
    by = lambda n: OrderBy(metric=OrderBy.MetricOrderBy(metric_name=n), desc=True)
    return {"users": int(t[0]), "sessions": int(t[1]), "pageviews": int(t[2]),
            "daily": [{"day": f"{d[:4]}-{d[4:6]}-{d[6:]}", "users": int(u), "sessions": int(s), "pageviews": int(p)} for d, u, s, p in daily],
            "top_pages": [{"page": p, "views": int(v), "users": int(u)} for p, v, u in ga(cl, prop, ["screenPageViews", "activeUsers"], ("pagePath",), 10, by("screenPageViews"), flt)],
            "sources": [{"channel": ch, "sessions": int(s)} for ch, s in ga(cl, prop, ["sessions"], ("sessionDefaultChannelGroup",), 10, by("sessions"), flt)]}

def spikes(cl, prop, raw, real, site, paths):
    """Days with raw sessions > 5x the median day where most sessions are Direct and off-site (bad host or unknown path)."""
    days = [d["sessions"] for d in raw["daily"]]
    if len(days) < 3: return []
    med = statistics.median(days); kept = {d["day"]: d["sessions"] for d in real["daily"]}
    hosts = {site["domain"], "www." + site["domain"]}; out = []
    for d in raw["daily"]:
        if d["sessions"] <= 5 * med: continue
        day = d["day"].replace("-", ""); flt = FilterExpression(filter=Filter(field_name="date", string_filter=Filter.StringFilter(value=day)))
        rows = ga(cl, prop, ["sessions"], ("sessionDefaultChannelGroup", "hostName", "pagePath"), 10000, flt=flt)
        direct = sum(r[3] for r in rows if r[0] == "Direct"); off = sum(r[3] for r in rows if r[1] not in hosts or r[2] not in paths)
        tot = sum(r[3] for r in rows) or 1
        if direct / tot > 0.5 and off / tot > 0.5:
            out.append({"day": d["day"], "sessions": d["sessions"], "median": med, "direct_share": round(direct / tot, 2),
                        "offsite_share": round(off / tot, 2), "kept_sessions": kept.get(d["day"], 0)})
    return out

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
            except Exception as x: out["ga4_note"] = "Admin API lookup unavailable (" + str(x).split(":")[0] + ")"
            if not prop and site.get("ga4_fallback"):
                prop = site["ga4_fallback"]; out["ga4_note"] = out.get("ga4_note", "") + f"; using seo-api configured ID {prop} (name not verified)"
        out["ga4_property"] = prop
        if prop:
            try:
                paths = allowlist(site); raw = ga_block(cl, prop); out["ga4"] = ga_block(cl, prop, real_filter(site, paths))
                out["ga4_raw"] = {k: raw[k] for k in ("users", "sessions", "pageviews")}
                out["ga4_filter"] = f"hostName in {site['domain']} (+www), pagePath in sitemap allowlist ({len(paths)} paths)"
                out["bot_spikes"] = spikes(cl, prop, raw, out["ga4"], site, paths)
            except Exception as x: out["ga4_error"] = err(x)
        else: out["ga4_error"] = f"property '{site['ga4_name']}' not in account summaries"
        try: out["gsc"] = gsc_block(sc, site["domain"])
        except Exception as x: out["gsc"] = {"error": err(x)}
        path = os.path.join(ROOT, "data", site["slug"], "web.json"); os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(out, open(path, "w"), indent=1); print("wrote", os.path.relpath(path, ROOT))

if __name__ == "__main__": main()
