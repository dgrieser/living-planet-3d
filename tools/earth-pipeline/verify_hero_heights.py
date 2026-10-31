"""Verifies the hero terrain against its source: Mapterhorn's zoom-16 heights (what the Living Earth
streams in the Lübbecke box) against NRW's official DGM1 from the state's WCS.

    python3 tools/earth-pipeline/verify_hero_heights.py [easting northing]   # UTM 32N centre, default Lübbecke

Downloads a 1 km × 1 km DGM1 window (DHHN2016 normal heights, 1 m), samples 400 points in it, decodes
the Mapterhorn tiles under them (Terrarium WebP) and compares bilinearly. Both carry the same national
heights, so the ellipsoidal heights of the sim (H + ζ from GCG2016) inherit exactly this difference.
Exit criterion of M2 (docs/earth-sim/12): within ±0.2 m. Needs Python 3 with Pillow (WebP support).
Result on 31 Oct 2026 for E 473000 N 5795000: mean 0.001 m, median 0.000 m, 5–95 % −0.028 … +0.031 m.
"""
import io
import math
import sys
import urllib.request

from PIL import Image

E0, N0 = (float(sys.argv[1]), float(sys.argv[2])) if len(sys.argv) > 2 else (473000.0, 5795000.0)
UA = {'User-Agent': 'living-planet-3d earth pipeline'}


def utm32_to_latlon(e, n):
    """Inverse UTM (zone 32, GRS80) – Krüger series, adequate to millimetres for this check."""
    a, f = 6378137.0, 1 / 298.257222101
    k0, e0, lon0 = 0.9996, 500000.0, math.radians(9)
    nn = f / (2 - f)
    A = a / (1 + nn) * (1 + nn ** 2 / 4 + nn ** 4 / 64)
    beta = [nn / 2 - 2 * nn ** 2 / 3 + 37 * nn ** 3 / 96, nn ** 2 / 48 + nn ** 3 / 15, 17 * nn ** 3 / 480]
    delta = [2 * nn - 2 * nn ** 2 / 3 - 2 * nn ** 3, 7 * nn ** 2 / 3 - 8 * nn ** 3 / 5, 56 * nn ** 3 / 15]
    xi, eta = n / (k0 * A), (e - e0) / (k0 * A)
    xi_ = xi - sum(b * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j, b in enumerate(beta))
    eta_ = eta - sum(b * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j, b in enumerate(beta))
    chi = math.asin(math.sin(xi_) / math.cosh(eta_))
    lat = chi + sum(d * math.sin(2 * (j + 1) * chi) for j, d in enumerate(delta))
    lon = lon0 + math.atan2(math.sinh(eta_), math.cos(xi_))
    return math.degrees(lat), math.degrees(lon)


def main():
    url = ('https://www.wcs.nrw.de/geobasis/wcs_nw_dgm?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=nw_dgm'
           f'&FORMAT=image/tiff&SUBSET=x({E0 - 500:.0f},{E0 + 500:.0f})&SUBSET=y({N0 - 500:.0f},{N0 + 500:.0f})')
    dgm = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()))
    px = dgm.load()
    z = 16
    n = 2 ** z
    tiles = {}

    def mapterhorn(x, y):
        if (x, y) not in tiles:
            raw = urllib.request.urlopen(urllib.request.Request(f'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp', headers=UA), timeout=60).read()
            tiles[(x, y)] = Image.open(io.BytesIO(raw)).convert('RGB').load()
        return tiles[(x, y)]

    def height(X, Y):
        r, g, b = mapterhorn(X // 512, Y // 512)[X % 512, Y % 512]
        return r * 256 + g + b / 256 - 32768

    diffs = []
    for i in range(400):
        cx, cy = 50 + (i % 20) * 45, 50 + (i // 20) * 45
        e, nn_ = E0 - 500 + cx + 0.5, N0 + 500 - cy - 0.5
        lat, lon = utm32_to_latlon(e, nn_)
        fx = (lon + 180) / 360 * n * 512 - 0.5
        fy = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n * 512 - 0.5
        x0, y0 = math.floor(fx), math.floor(fy)
        tx, ty = fx - x0, fy - y0
        v = (height(x0, y0) * (1 - tx) + height(x0 + 1, y0) * tx) * (1 - ty) + (height(x0, y0 + 1) * (1 - tx) + height(x0 + 1, y0 + 1) * tx) * ty
        diffs.append(v - px[cx, cy])
    diffs.sort()
    mean = sum(diffs) / len(diffs)
    p05, p95 = diffs[len(diffs) // 20], diffs[-len(diffs) // 20]
    ok = abs(mean) <= 0.2 and p05 >= -0.2 and p95 <= 0.2
    print(f'n={len(diffs)} mean={mean:.3f} m median={diffs[len(diffs) // 2]:.3f} m p05={p05:.3f} m p95={p95:.3f} m → {"within" if ok else "OUTSIDE"} ±0.2 m')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
