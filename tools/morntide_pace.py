"""Build data/morntide/pace.json from data/morntide/snapshots.json (real Studio readings only).
Method: linear rate between the first and last valid points in the window; projection = last + remaining/rate.
Subs: rows with Studio-exact subs (null = missing, skipped). Hours: Studio Earn, dated by the meter 'as of' date in the notes.
"""
import json, re, datetime as dt
D = dt.date.fromisoformat
MIN_POINTS = 3
snaps = json.load(open('data/morntide/snapshots.json'))

def as_of(s):
    m = re.search(r'as of (\w{3}) (\d+), (\d{4})', s.get('notes') or s.get('note') or '')
    return dt.datetime.strptime(' '.join(m.groups()), '%b %d %Y').date().isoformat() if m else None

def pace(label, goal, pts, unit):
    pts = sorted(dict(pts).items())
    out = {'metric': label, 'goal': goal, 'unit': unit, 'points': [{'day': d, 'value': v} for d, v in pts]}
    if len(pts) < MIN_POINTS:
        out['status'] = f'Too few points ({len(pts)} < {MIN_POINTS}); no projection.'
        return out
    (d0, v0), (d1, v1) = pts[0], pts[-1]
    days = (D(d1) - D(d0)).days
    rate = (v1 - v0) / days if days else 0
    out.update(rate_per_day=round(rate, 3), window=f'{d0} to {d1} ({days} days)', last=v1)
    if rate <= 0:
        out['status'] = 'No net growth in window; no projection.'
    else:
        out['projected'] = (D(d1) + dt.timedelta(days=round((goal - v1) / rate))).isoformat()
        out['status'] = 'projected'
    return out

subs = [(s['day'], s['subs']) for s in snaps if s.get('subs') is not None]
hours, seen = [], set()
for s in sorted(snaps, key=lambda s: s['day']):
    a = as_of(s)
    if a and s.get('earn') is not None and a not in seen:
        seen.add(a); hours.append((a, s['earn']))
res = {'method': 'Linear: (last - first) / days between first and last point in snapshots.json; projected = last date + remaining / rate. '
       f'Needs >= {MIN_POINTS} points. Subs = Studio exact by reading day (missing days skipped). Hours = Studio Earn by meter "as of" date (each reading lags ~5 days).',
       'source': 'data/morntide/snapshots.json', 'metrics': [pace('Subscribers', 1000, subs, 'subs'), pace('Public watch hours', 4000, hours, 'h')]}
json.dump(res, open('data/morntide/pace.json', 'w'), indent=1)
print(json.dumps(res, indent=1))
