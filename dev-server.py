#!/usr/bin/env python3
"""Local dev server for SoccerTime that disables HTTP caching entirely.

`python -m http.server` sends no Cache-Control header at all, which leaves browsers free to
heuristically cache any response - including index.html itself - for a while with no way to
force it out short of a full browser-wide "clear all cached images and files" (per-site "clear
site data" only covers storage: cookies, Cache Storage, service workers - not this). That's been
the actual cause of more than one "it's still not updating" report while developing this PWA.
Every response from this server is explicitly marked non-cacheable instead, so a normal reload
always hits the network.

Usage: python dev-server.py [port]  (defaults to 8080, same as `python -m http.server`)
"""
import http.server
import sys


class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    http.server.test(HandlerClass=NoCacheHTTPRequestHandler, port=port, bind='0.0.0.0')
