#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build a single-file index.html for WorkBuddy Sites deployment.

WorkBuddy Sites' gateway rewrites every path (including /assets/*) back to the
entry index.html, so a multi-file static site cannot serve its JS/CSS there.
This script inlines all local assets into one self-contained index.html so the
deployed artifact has zero external requests.

Run:  python3 build.py   (from the web/ directory)
Output: ./index.html  (overwrites)
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "src-template.html")


def read(p):
    with io.open(os.path.join(HERE, p), "r", encoding="utf-8") as f:
        return f.read()


def main():
    html = read("src-template.html")

    styles = read("assets/styles.css")
    sdk = read("vendor/workbuddy-cloud-sdk.global.js")
    samples = read("assets/samples.js")
    app = read("assets/app.js")
    account = read("assets/account.js")

    html = html.replace(
        '<link rel="stylesheet" href="assets/styles.css" />',
        "<style>\n" + styles + "\n</style>",
    )
    html = html.replace(
        '<script src="vendor/workbuddy-cloud-sdk.global.js"></script>',
        "<script>\n" + sdk + "\n</script>",
    )
    html = html.replace(
        '<script src="assets/samples.js"></script>',
        "<script>\n" + samples + "\n</script>",
    )
    html = html.replace(
        '<script src="assets/app.js"></script>',
        "<script>\n" + app + "\n</script>",
    )
    html = html.replace(
        '<script src="assets/account.js"></script>',
        "<script>\n" + account + "\n</script>",
    )

    # sanity: ensure no leftover external local refs
    for tag in ('assets/styles.css', 'workbuddy-cloud-sdk.global.js',
                'assets/samples.js', 'assets/app.js', 'assets/account.js'):
        if ('src="' + tag + '"' in html) or ('href="' + tag + '"' in html):
            raise SystemExit("ABORT: placeholder not replaced -> " + tag)

    with io.open(os.path.join(HERE, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

    print("Built index.html (%d bytes), external refs: %d"
          % (len(html), html.count('<script src') + html.count('<link rel="stylesheet"')))


if __name__ == "__main__":
    main()
