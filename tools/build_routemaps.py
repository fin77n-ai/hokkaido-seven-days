#!/usr/bin/env python3
"""Build the per-day route map panels (每日路线图) into index.html.

Each panel is a static SVG (numbered stops, legs, times) plus an empty
<g class="rm-base"> that tools/routemap.js fills at runtime with OpenStreetMap
outlines from OpenFreeMap vector tiles (cached by sw.js for offline use).
Edit DAYS / FRAMES below, then run:  python3 tools/build_routemaps.py
"""
import json, math, re, html, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNTIME = (ROOT / 'tools/routemap.js').read_text()
INDEX = ROOT / 'index.html'

# panel frames (lon0, lat0, lon1, lat1) — must match the frames used to project routemap_base.json
FRAMES = {
    'd1': (140.8115, 42.5605, 140.8305, 42.5705),
    'd2': (140.780, 42.556, 140.852, 42.632),
    'd3': (141.133, 42.446, 141.192, 42.503),
    'd4': (141.332, 43.050, 141.368, 43.083),
    'd5': (140.966, 43.170, 141.072, 43.208),
    'd6': (141.192, 43.044, 141.368, 43.096),
    'd7': (141.316, 43.030, 141.360, 43.073),
}
DAY_COLORS = ['#C0532E', '#285A86', '#3C7757', '#8A5CB5', '#C98A1B', '#2E8C93', '#B23A6B']

P = {  # name, lat, lon
    'manseikaku': ('万世阁', 42.565819, 140.824675), 'boyotei': ('望羊蹄', 42.565045, 140.819057),
    'tunnel': ('星光隧道', 42.5662, 140.8196), 'ukimido': ('浮见堂', 42.5676, 140.829),
    'silo': ('筒仓展望台', 42.626188, 140.799441), 'sendoan': ('仙堂庵', 42.5653, 140.8197),
    'toyakanko': ('洞爷观光酒店私汤', 42.565692, 140.820895),
    'noboribetsu': ('JR 登别站', 42.45201, 141.1808), 'jigokudani': ('地狱谷', 42.497572, 141.145335),
    'stream': ('STREAM 酒店', 43.055177, 141.35224), 'hokudai': ('北海道大学', 43.0795, 141.3373),
    'rokkatei': ('六花亭', 43.066023, 141.346554), 'nanga': ('Sapporo Factory', 43.0646, 141.3627),
    'daimaru': ('大丸 · 札幌站', 43.068, 141.3492), 'parco': ('PARCO · 狸小路', 43.058728, 141.353158),
    'daruma': ('达摩', 43.0537, 141.3518), 'asari': ('朝里站', 43.17691, 141.06369),
    'motaru': ('南小樽站', 43.18708, 141.00764), 'orgel': ('堺町通', 43.190579, 141.007792),
    'sankaku': ('三角市场', 43.1975, 140.9945), 'funami': ('船见坂', 43.198825, 140.993147),
    'tengu': ('天狗山缆车', 43.177937, 140.975161), 'canal': ('小樽运河', 43.202023, 141.000601),
    'otaru': ('小樽站', 43.19734, 140.99415), 'teine': ('手稻滑雪场', 43.086697, 141.204206),
    'kani': ('螃蟹本家', 43.0556, 141.3554), 'inari': ('伏见稻荷', 43.034966, 141.32537),
    'jrsapporo': ('JR 札幌站', 43.06866, 141.35079),
}

# each day: list of stops; leg = how you get to this stop from the previous one
# leg: walk / car (taxi, bus) / train ; stop: (key, time, label, leg, numbered)
DAYS = {
    'd1': dict(title='抵达洞爷湖', enter=('sw', '从洞爷站 🚕 12 分'), stops=[
        ('manseikaku', '18:15', '入住万世阁', 'car', False),
        ('boyotei', '18:45', '晚餐 望羊蹄', 'walk', True),
        ('tunnel', '20:00', '星光隧道', 'walk', True)]),
    'd2': dict(title='洞爷湖雪景 × 私汤', stops=[
        ('manseikaku', '09:15', '万世阁出发', None, False),
        ('ukimido', '09:30', '浮见堂公园', 'walk', True),
        ('silo', '10:45', '筒仓展望台', 'car', True, [(42.5700, 140.8085), (42.5880, 140.7990), (42.6080, 140.7930)]),
        ('sendoan', '12:30', '仙堂庵 · 冈田屋', 'car', True, [(42.6080, 140.7930), (42.5880, 140.7990), (42.5700, 140.8085)]),
        ('toyakanko', '15:15', '洞爷观光酒店私汤', 'walk', True)]),
    'd3': dict(title='登别地狱谷 → 札幌', before=[('09:50', '万世阁 → 洞爷站 · 🚄 北斗 5 号')], stops=[
        ('noboribetsu', '11:28', '登别站 · 存行李', 'train', True),
        ('jigokudani', '12:00', '地狱谷 + 拉面', 'car', True),
        ('noboribetsu', '14:48', '回登别站取行李', 'car', False)],
        after=[('14:48', '🚄 北斗 11 号去札幌'), ('17:15', 'STREAM 酒店入住'), ('18:30', '根室花丸 · 酒店楼下')]),
    'd4': dict(title='北大 × 买装备 × 购物', stops=[
        ('stream', '09:40', 'STREAM 酒店', None, False),
        ('hokudai', '10:00', '北海道大学', 'train', True),
        ('rokkatei', '11:45', '六花亭 午餐', 'walk', True),
        ('nanga', '13:30', 'NANGA · Mont-bell', 'car', True),
        ('daimaru', '15:30', '大丸 · Stellar Place', 'car', True),
        ('parco', '17:15', 'PARCO · 狸小路', 'walk', True),
        ('daruma', '18:45', '达摩 成吉思汗', 'walk', True)]),
    'd5': dict(title='朝里站 × 小樽蓝调', enter=('e', '⇄ 札幌'), stops=[
        ('asari', '10:30', '朝里站 看海', 'train', True),
        ('motaru', '11:10', '南小樽站', 'train', False),
        ('orgel', '11:15', '堺町通 · 音乐盒堂', 'walk', True),
        ('sankaku', '13:00', '三角市场 午餐', 'walk', True),
        ('funami', '14:15', '船见坂', 'walk', True),
        ('tengu', '14:45', '天狗山缆车', 'car', True),
        ('canal', '16:45', '小樽运河', 'car', True),
        ('otaru', '17:30', '小樽站', 'walk', False)],
        after=[('18:30', '汤咖喱 Suage+ · 酒店旁')]),
    'd6': dict(title='手稻滑雪 × 蟹宴', stops=[
        ('stream', '08:00', '集合上车', None, False),
        ('teine', '09:30', '手稻 团课', 'car', True),
        ('stream', '17:00', '回酒店休息', 'car', False),
        ('kani', '19:00', '三大蟹会席', 'walk', True)]),
    'd7': dict(title='伏见稻荷 → 机场', exit=('se', '🚄 12:30 去新千岁机场'), stops=[
        ('stream', '09:00', '退房存行李', None, False),
        ('inari', '09:30', '伏见稻荷神社', 'car', True),
        ('stream', '12:00', '取行李', 'car', False),
        ('jrsapporo', '12:30', 'JR 札幌站', 'train', True)],
        after=[('13:15', '新千岁国内线 2F 伴手礼'), ('16:30', '3F 拉面道场'), ('19:30', 'NH78 → 羽田 → 浦东')]),
}

# static place labels (lat, lon, text, class)
LABELS = {
    'd1': [(42.5690, 140.8240, '洞爷湖', 'lake')],
    'd2': [(42.5950, 140.8300, '洞 爷 湖', 'lake')],
    'd3': [(42.4940, 141.1560, '登别温泉', 'town'), (42.4500, 141.1650, '太平洋', 'sea')],
    'd4': [(43.0605, 141.3410, '大通公园', 'town'), (43.0700, 141.3600, '札幌站', 'town')],
    'd5': [(43.2040, 141.0400, '石 狩 湾', 'sea')],
    'd6': [(43.0700, 141.2500, '手稻', 'town'), (43.0820, 141.3300, '札幌市区', 'town')],
    'd7': [(43.0605, 141.3410, '大通公园', 'town'), (43.0420, 141.3370, '中岛公园', 'town')],
}
MODE = {'walk': ('走路', ''), 'car': ('打车/巴士', '10 8'), 'train': ('JR/地铁', '3 7')}


def frame(d):
    lo0, la0, lo1, la1 = FRAMES[d]
    W = 600
    H = round(W * (la1 - la0) / ((lo1 - lo0) * math.cos((la0 + la1) / 2 * math.pi / 180)))
    return lo0, la0, lo1, la1, W, H


def proj(d, lat, lon):
    lo0, la0, lo1, la1, W, H = frame(d)
    return round((lon - lo0) / (lo1 - lo0) * W, 1), round((la1 - lat) / (la1 - la0) * H, 1)


def edge_arrow(W, H, where, text, col, inbound):
    pos = {'w': (0, H * .55, 1, 0), 'e': (W, H * .6, -1, 0), 'sw': (0, H, 1, -1), 'ne': (W, 0, -1, 1),
           'se': (W, H, -1, -1), 'n': (W / 2, 0, 0, 1), 's': (W / 2, H, 0, -1)}[where]
    x, y, dx, dy = pos
    n = math.hypot(dx, dy)
    dx, dy = dx / n, dy / n
    x1, y1 = x + dx * 70, y + dy * 70
    a, b = ((x, y), (x1, y1)) if inbound else ((x1, y1), (x, y))
    tx, ty = x + dx * 84, y + dy * 84 + (24 if dy <= 0 else -6)
    anchor = 'start' if dx > 0.3 else 'end' if dx < -0.3 else 'middle'
    if dy == 0:  # horizontal arrow: label above it, against the edge
        tx, ty = (W - 10 if dx < 0 else 10), y - 16
    tx = min(max(tx, 8), W - 8)
    ty = min(max(ty, 26), H - 10)
    return (f'<path class="rm-edge" d="M{a[0]:.0f} {a[1]:.0f}L{b[0]:.0f} {b[1]:.0f}" stroke="{col}" marker-end="url(#rmA{col[1:]})"/>'
            f'<text class="rm-edge-t" x="{tx:.0f}" y="{ty:.0f}" text-anchor="{anchor}">{html.escape(text)}</text>')


def panel(d, idx):
    lo0, la0, lo1, la1, W, H = frame(d)
    spec, col = DAYS[d], DAY_COLORS[idx]
    minor = '0' if d == 'd6' else '1'
    out = [f'<svg class="rm-svg" viewBox="0 0 {W} {H}" role="img" aria-label="D{idx+1} 路线图：{html.escape(spec["title"])}">',
           f'<defs><clipPath id="rmC{d}"><rect width="{W}" height="{H}" rx="14"/></clipPath>'
           f'<marker id="rmA{col[1:]}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1,1 L9,5 L1,9 Z" fill="{col}"/></marker></defs>',
           f'<g clip-path="url(#rmC{d})"><rect class="rm-bg" width="{W}" height="{H}"/>']
    out.append(f'<g class="rm-base" data-bb="{lo0},{la0},{lo1},{la1}" data-w="{W}" data-h="{H}" data-minor="{minor}"></g>')
    for lat, lon, t, c in LABELS.get(d, []):
        x, y = proj(d, lat, lon)
        out.append(f'<text class="rm-lbl {c}" x="{x}" y="{y}">{t}</text>')
    stops = spec['stops']
    pts = [proj(d, P[st[0]][1], P[st[0]][2]) for st in stops]
    vias = [[proj(d, la, lo) for la, lo in (st[5] if len(st) > 5 else [])] for st in stops]
    for i in range(1, len(stops)):
        mode = stops[i][3] or 'walk'
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        if (x0, y0) == (x1, y1):
            continue
        # gentle curve so out-and-back legs don't sit on top of each other
        dash = MODE[mode][1]
        attrs = f' stroke="{col}"' + (f' stroke-dasharray="{dash}"' if dash else '') + f' marker-mid="url(#rmA{col[1:]})"'
        if vias[i]:
            chain = [(x0, y0)] + vias[i] + [(x1, y1)]
            out.append('<path class="rm-leg" d="M' + 'L'.join(f'{x:.0f} {y:.0f}' for x, y in chain) + '"' + attrs.replace(f' marker-mid="url(#rmA{col[1:]})"', '') + '/>')
            continue
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        L = math.hypot(x1 - x0, y1 - y0)
        off = min(40, L * .18)
        cx, cy = mx - (y1 - y0) / L * off, my + (x1 - x0) / L * off
        out.append(f'<path class="rm-leg" d="M{x0} {y0}Q{cx:.1f} {cy:.1f} {x1} {y1}"' + attrs + '/>')
    if spec.get('enter'):
        out.append(edge_arrow(W, H, spec['enter'][0], spec['enter'][1], col, True))
    if spec.get('exit'):
        out.append(edge_arrow(W, H, spec['exit'][0], spec['exit'][1], col, False))
    out.append('</g>')
    # pins: numbered stops get a coloured disc, waypoints (hotel/stations) a small ring
    n = 0
    drawn = {}
    names = []
    placed = []
    for st, (x, y) in zip(stops, pts):
        if not st[4] and st[0] not in drawn:
            drawn[st[0]] = 1
            placed.append((x, y))
            out.append(f'<g class="rm-way" transform="translate({x} {y})"><circle r="10"/></g>')
            names.append((x, y, P[st[0]][0], 18))
    for st, (x, y) in zip(stops, pts):
        k, t, lab, mode, num = st[:5]
        if num:
            n += 1
            px, py = x, y
            if any(math.hypot(px - a, py - b) < 34 for a, b in placed):
                for ox, oy in ((30, -26), (-30, -26), (30, 26), (-30, 26), (0, -40), (0, 40), (44, 0), (-44, 0)):
                    cx, cy = x + ox, y + oy
                    if 20 < cx < W - 20 and 20 < cy < H - 20 and all(math.hypot(cx - a, cy - b) >= 34 for a, b in placed):
                        px, py = cx, cy
                        break
            if (px, py) != (x, y):
                out.append(f'<path class="rm-lead" d="M{x} {y}L{px} {py}" stroke="{col}"/><circle class="rm-dot" cx="{x}" cy="{y}" r="5" fill="{col}"/>')
            placed.append((px, py))
            out.append(f'<g class="rm-pin" transform="translate({px} {py})"><circle r="17" fill="{col}"/><text y="8">{n}</text></g>')
            names.append((px, py, P[k][0], 26))

    # names: try right, left, below, above; skip if all collide
    boxes = [(x - r, y - r, x + r, y + r) for x, y, _, r in names]
    seen = set()
    for x, y, t, r in names:
        if t in seen:
            continue
        seen.add(t)
        w = len(t) * 22 * 0.9
        for bx, by, an in ((x + r + 6, y + 8, 'start'), (x - r - 6, y + 8, 'end'), (x, y + r + 26, 'middle'), (x, y - r - 8, 'middle')):
            x0 = bx if an == 'start' else bx - w if an == 'end' else bx - w / 2
            b = (x0, by - 22, x0 + w, by + 5)
            if b[0] < 4 or b[2] > W - 4 or b[1] < 4 or b[3] > H - 4:
                continue
            if any(b[0] < o[2] and b[2] > o[0] and b[1] < o[3] and b[3] > o[1] for o in boxes):
                continue
            boxes.append(b)
            out.append(f'<text class="rm-name" x="{bx:.0f}" y="{by:.0f}" text-anchor="{an}">{html.escape(t)}</text>')
            break
    out.append(f'<text class="rm-osm" x="{W-10}" y="{H-10}" text-anchor="end">© OpenStreetMap · OpenFreeMap</text></svg>')
    # stop list
    li = []
    n = 0
    for t, lab in spec.get('before', []):
        li.append(f'<li class="after"><b class="w">·</b><time>{t}</time>{html.escape(lab)}</li>')
    for k, t, lab, mode, num, *_ in stops:
        via = f'<span class="rm-via">{MODE[mode][0]}</span>' if mode else ''
        if num:
            n += 1
            badge = f'<b style="background:{col}">{n}</b>'
        else:
            badge = '<b class="w">·</b>'
        li.append(f'<li>{via}{badge}<time>{t}</time>{html.escape(lab)}</li>')
    for t, lab in spec.get('after', []):
        li.append(f'<li class="after"><b class="w">·</b><time>{t}</time>{html.escape(lab)}</li>')
    used = sorted({st[3] for st in stops if st[3]}, key=list(MODE).index)
    legend = ''.join(f'<span><i class="lg-{m}" style="--c:{col}"></i>{MODE[m][0]}</span>' for m in used)
    return (f'<details class="exp route-map" data-day="{idx+1}"><summary>🗺️ 今日路线图 · {n} 站</summary><div class="exp-bd">'
            + ''.join(out) + f'<div class="rm-legend">{legend}</div><ol class="rm-list">' + ''.join(li) + '</ol></div></details>')


CSS = '''
  /* 每日路线图 */
  details.route-map{margin:10px 0 4px;}
  .rm-svg{display:block;width:100%;height:auto;border-radius:14px;border:1px solid var(--line);margin-top:6px;}
  .rm-bg{fill:#F4F1EA;} .rm-park{fill:#DCE8D2;} .rm-water{fill:#C9DDEB;} .rm-coast{fill:none;stroke:#9EC3DC;stroke-width:6;stroke-linejoin:round;}
  .rm-river{fill:none;stroke:#A8CBE3;stroke-width:4;stroke-linecap:round;}
  .rm-r3{fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;}
  .rm-r2{fill:none;stroke:#fff;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;}
  .rm-r1{fill:none;stroke:#F2D9A6;stroke-width:7;stroke-linecap:round;stroke-linejoin:round;}
  .rm-rail{fill:none;stroke:#8A8F98;stroke-width:4;} .rm-rail-d{fill:none;stroke:#fff;stroke-width:2;stroke-dasharray:8 8;}
  .rm-lbl{font-size:22px;fill:#8A8F98;font-weight:700;text-anchor:middle;font-family:var(--font-cjk);paint-order:stroke;stroke:#F4F1EA;stroke-width:5px;}
  .rm-lbl.lake,.rm-lbl.sea{fill:#5D8DB0;stroke:#C9DDEB;letter-spacing:4px;}
  .rm-leg{fill:none;stroke-width:5;stroke-linecap:round;opacity:.92;}
  .rm-edge{fill:none;stroke-width:5;stroke-dasharray:3 7;stroke-linecap:round;}
  .rm-edge-t{font-size:21px;font-weight:700;fill:#3A3F47;font-family:var(--font-cjk);paint-order:stroke;stroke:#F4F1EA;stroke-width:6px;}
  .rm-pin circle{stroke:#fff;stroke-width:4;} .rm-pin text{fill:#fff;font-size:22px;font-weight:800;text-anchor:middle;font-family:var(--font-ui,sans-serif);}
  .rm-way circle{fill:#fff;stroke:#3A3F47;stroke-width:4;}
  .rm-name{font-size:22px;font-weight:700;fill:#2A2E35;font-family:var(--font-cjk);paint-order:stroke;stroke:#fff;stroke-width:6px;stroke-linejoin:round;}
  .rm-osm{font-size:16px;fill:#8A8F98;}
  .rm-lead{stroke-width:3;} details.route-map summary::before{content:none;}
  .rm-base[data-state="loading"]+.rm-lbl{opacity:.5;}
  .rm-legend{display:flex;flex-wrap:wrap;gap:12px;margin:8px 2px 2px;font-size:12px;color:var(--ink-soft);}
  .rm-legend i{display:inline-block;width:26px;height:0;border-top:3px solid var(--c);vertical-align:middle;margin-right:5px;}
  .rm-legend i.lg-car{border-top-style:dashed;} .rm-legend i.lg-train{border-top-style:dotted;border-top-width:4px;}
  .rm-list{list-style:none;margin:8px 0 0;padding:0;font-size:13px;line-height:1.5;}
  .rm-list li{display:flex;align-items:baseline;gap:7px;padding:5px 0;border-top:1px dashed var(--line);flex-wrap:wrap;}
  .rm-list li:first-child{border-top:none;}
  .rm-list b{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:50%;color:#fff;font-size:12px;}
  .rm-list b.w{background:none;color:var(--ink-faint);}
  .rm-list time{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;}
  .rm-list li.after{color:var(--ink-soft);}
  .rm-via{flex-basis:100%;font-size:12px;color:var(--ink-faint);padding-left:27px;}
  .rm-via::before{content:"↓ ";}
  @media (prefers-color-scheme:dark){ :root:not([data-theme="light"]) .rm-svg{filter:brightness(.9);} }
'''


def main():
    s = INDEX.read_text()
    # remove a previous build
    s = re.sub(r'<details class="exp route-map".*?</ol></div></details>\n    ', '', s, flags=re.S)
    s = re.sub(r'\n  /\* 每日路线图 \*/.*?@media \(prefers-color-scheme:dark\)\{ :root:not\(\[data-theme="light"\]\) \.rm-svg\{filter:brightness\(\.9\);\} \}\n', '\n', s, flags=re.S)
    for i, d in enumerate(DAYS):
        m = re.search(r'(<article class="day-card" id="%s">.*?)(<div class="route">)' % d, s, re.S)
        assert m, d
        s = s[:m.end(1)] + panel(d, i) + '\n    ' + s[m.end(1):]
    anchor = '  .ph-link{margin:8px 0 6px;}\n'
    assert anchor in s
    s = s.replace(anchor, anchor + CSS.lstrip('\n'), 1)
    s = re.sub(r'  // >>> routemap.js.*?// <<< routemap.js\n', '', s, flags=re.S)
    js_anchor = "  var statusEl=document.getElementById('appStatus');"
    assert s.count(js_anchor) == 1
    s = s.replace(js_anchor, '  // >>> routemap.js (generated from tools/routemap.js)\n' + RUNTIME + '  // <<< routemap.js\n' + js_anchor)
    INDEX.write_text(s)
    print('ok', len(s))


if __name__ == '__main__':
    main()
