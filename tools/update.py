"""Read-only updater. For each channel in channels.json writes data/<slug>/tracking.json from
public YouTube pages (yt-dlp), the Studio reading already in data/<slug>/latest.json, and the
DistroKid registry CSV (UNVERIFIED Spotify links left out). No keys, no writes anywhere else.
  python3 tools/update.py [--only morntide] [--registry PATH]"""
import json, csv, argparse, subprocess, datetime, os
p = argparse.ArgumentParser()
p.add_argument('--only'); p.add_argument('--registry', default='/workspace/registry/distrokid_streaming_registry.csv')
a = p.parse_args()
LINKS = ['Spotify URL', 'Apple Music URL', 'YouTube Music URL', 'Amazon Music URL']

def tab(ch_id, t):
    r = subprocess.run(['yt-dlp', '--flat-playlist', '-J', f'https://www.youtube.com/channel/{ch_id}/{t}'],
                       capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else {"entries": []}

def releases(artist):
    out = []
    for r in csv.DictReader(open(a.registry, encoding='utf-8')):
        if r['Artist/Channel'] != artist: continue
        st = {c.split()[0]: r[c] for c in LINKS if r[c].startswith('http')}  # skips UNVERIFIED
        for part in r['Other (Tidal/Deezer)'].split('|'):
            n, _, u = part.strip().partition(': ')
            if u.startswith('http'): st[n.split()[0]] = u
        out.append({"title": r['Release title'], "type": r['Type'], "date": r['Release date'],
                    "status": r['Distro status'], "stores": st, "checked": r['Last checked (ET)']})
    return sorted(out, key=lambda r: r['date'], reverse=True)

row = lambda e: {"id": e['id'], "title": e.get('title'), "views": e.get('view_count'),
                 "duration": e.get('duration'), "live": e.get('live_status')}
for c in json.load(open('channels.json')):
    if a.only and c['slug'] != a.only: continue
    path = f"data/{c['slug']}"
    L = json.load(open(f'{path}/latest.json')); k = L.get('kpis', {})
    V, S = tab(c['channel_id'], 'videos'), tab(c['channel_id'], 'streams')
    streams = [row(e) for e in S['entries']]
    tag = (c.get('live_tag') or '').lower()
    for s in streams: s['tag'] = c['live_tag'] if tag and tag.split()[-1] in (s['title'] or '').lower() else None
    d = {"fetched": datetime.datetime.now().astimezone().isoformat(timespec='minutes'),
         "subs_public": V.get('channel_follower_count'), "studio_day": L.get('day'),
         "subs_studio": k.get('subs'), "earn": k.get('earn'),
         "uploads": [row(e) for e in V['entries']], "streams": streams,
         "releases": releases(c['artist']),
         "sources": {"youtube": "yt-dlp public /videos and /streams tabs",
                     "hours": f"YouTube Studio Earn reading in {path}/latest.json ({L.get('day')})",
                     "releases": "DistroKid Streaming Link Registry CSV"}}
    json.dump(d, open(f'{path}/tracking.json', 'w'), ensure_ascii=False, indent=1)
    print(c['slug'], 'subs', d['subs_public'], 'uploads', len(d['uploads']), 'lives', len(streams),
          'tagged', sum(1 for s in streams if s['tag']), 'releases', len(d['releases']))
