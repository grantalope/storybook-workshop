#!/usr/bin/env python3
"""Generate 256px JPEG q80 thumbnails for every entry in the repo bank manifest.

The full-resolution pregen bank lives OUT of git (see docs/pregen-bank.md).
This script reads static/pregen-bank/manifest.json (built by
scripts/pregen/build-manifest-from-bank.mjs), opens each entry's source PNG in
the bank, and writes a max-256px JPEG quality-80 thumbnail to the entry's
`thumb` path (relative to the manifest's directory).

RGBA/LA/P sources are composited over white before JPEG conversion.

Usage:
    python3 scripts/pregen/build-thumbs.py --bank /abs/path/to/.bank \
        [--manifest static/pregen-bank/manifest.json] [--force]
"""
import argparse
import json
import os
import sys

from PIL import Image

THUMB_MAX_PX = 256
JPEG_QUALITY = 80


def build_thumb(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with Image.open(src) as im:
        im.thumbnail((THUMB_MAX_PX, THUMB_MAX_PX), Image.LANCZOS)
        if im.mode == 'P':
            im = im.convert('RGBA')
        if im.mode in ('RGBA', 'LA'):
            bg = Image.new('RGB', im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        elif im.mode != 'RGB':
            im = im.convert('RGB')
        im.save(dst, 'JPEG', quality=JPEG_QUALITY, optimize=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    default_manifest = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..',
        'static', 'pregen-bank', 'manifest.json')
    ap.add_argument('--bank', required=True, help='bank root directory (full-res PNGs)')
    ap.add_argument('--manifest', default=default_manifest)
    ap.add_argument('--force', action='store_true', help='rebuild even if thumb is up to date')
    args = ap.parse_args()

    manifest_path = os.path.abspath(args.manifest)
    base = os.path.dirname(manifest_path)
    bank = os.path.abspath(os.path.expanduser(args.bank))

    with open(manifest_path) as fh:
        manifest = json.load(fh)

    made = skipped = 0
    failures = []
    for entry in manifest['entries']:
        src = os.path.join(bank, entry['file'])
        thumb_rel = entry.get('thumb') or 'thumbs/{}.jpg'.format(entry['assetId'])
        dst = os.path.join(base, thumb_rel)
        try:
            if (not args.force and os.path.exists(dst)
                    and os.path.getmtime(dst) >= os.path.getmtime(src)):
                skipped += 1
                continue
            build_thumb(src, dst)
            made += 1
        except Exception as err:  # noqa: BLE001 - report every failed asset
            failures.append({'assetId': entry['assetId'], 'error': str(err)})

    print(json.dumps({
        'manifest': manifest_path,
        'total': len(manifest['entries']),
        'made': made,
        'skipped': skipped,
        'failed': len(failures),
        'failures': failures[:20],
    }, indent=2))
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
