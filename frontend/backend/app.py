from flask import Flask, request, jsonify
from flask_cors import CORS
from urllib.request import Request, urlopen
from urllib.parse import urlparse
from html.parser import HTMLParser
import re
import socket
import ipaddress

app = Flask(__name__)

CORS(app, origins=[
    "http://127.0.0.1:5500",
    "http://localhost:5500"
])


class WebsiteTextExtractor(HTMLParser):

    def __init__(self):
        super().__init__()
        self.text = []
        self.skip_content = False
        self.preselected = []
        self.ad_markers = []
        self._last_checked = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)

        if tag in ["script", "style", "noscript", "svg"]:
            self.skip_content = True

        # Pre-checked checkboxes
        if (tag == "input"
                and (a.get("type") or "").lower() == "checkbox"
                and "checked" in a):
            item = {
                "hint": a.get("name") or a.get("id") or a.get("value") or "",
                "label": ""
            }
            self.preselected.append(item)
            self._last_checked = item

        # Elements marked as ads
        marker = ((a.get("class") or "") + " " + (a.get("id") or "")).lower()
        if re.search(r"sponsored|advert|promoted", marker):
            self.ad_markers.append(marker.strip())

    def handle_endtag(self, tag):
        if tag in ["script", "style", "noscript", "svg"]:
            self.skip_content = False

    def handle_data(self, data):
        if not self.skip_content:
            cleaned = data.strip()
            if cleaned:
                self.text.append(cleaned)
                if self._last_checked and not self._last_checked["label"]:
                    self._last_checked["label"] = cleaned
                    self._last_checked = None


def validate_url(url):
    try:
        parsed = urlparse(url)

        if parsed.scheme not in ["http", "https"]:
            return False

        if not parsed.hostname or parsed.username or parsed.password:
            return False

        # TESTING ONLY: allow local test pages. Remove for final version.
        if parsed.hostname in ["127.0.0.1", "localhost"]:
            return True

        addresses = socket.getaddrinfo(
            parsed.hostname, None, type=socket.SOCK_STREAM
        )
        for address in addresses:
            ip = ipaddress.ip_address(address[4][0])
            if not ip.is_global:
                return False

        return True

    except Exception:
        return False


def fetch_website(url):
    req = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9"
        }
    )

    with urlopen(req, timeout=15) as response:
        content_type = response.headers.get("Content-Type", "").lower()
        if "text/html" not in content_type:
            raise ValueError("The URL does not return an HTML webpage.")
        html = response.read(2_000_000).decode("utf-8", errors="ignore")

    return html


PATTERNS = {
    "Fake Urgency": [
        r"limited time offer", r"offer ends", r"ends in \d+", r"deal ends",
        r"act now", r"hurry", r"only today", r"countdown",
        r"ending soon", r"sale ends", r"today only"
    ],
    "Scarcity": [
        r"only \d+ left", r"\d+ left in stock", r"few items left",
        r"limited stock", r"almost sold out", r"selling fast",
        r"last few available", r"only few left", r"hurry, only"
    ],
    "Confirmshaming": [
        r"no thanks", r"i don't want", r"i do not want",
        r"i hate saving money", r"miss out on", r"no, i don't"
    ],
    "Hidden Costs": [
        r"additional fees", r"extra charges", r"processing fee",
        r"convenience fee", r"handling fee", r"handling charges",
        r"delivery fee", r"service fee", r"platform fee",
        r"packaging fee", r"payment handling"
    ],
    "Disguised Ads": [
        r"\bsponsored\b", r"\bpromoted\b",
        r"advertisement", r"paid promotion", r"\bad\b by"
    ]
}

RISKY_CHECKBOX = (
    r"insur|protect|warranty|donat|newsletter|subscribe|gift|add|offer|share"
)


def detect_dark_patterns(text, preselected=None, ad_markers=None):
    detected = []
    text = text.lower()

    for category, keywords in PATTERNS.items():
        matched = []
        for k in keywords:
            m = re.search(k, text)
            if m:
                matched.append(m.group(0))

        if category == "Disguised Ads" and ad_markers:
            matched += ["element marked: " + m for m in ad_markers[:3]]

        if matched:
            detected.append({
                "pattern": category,
                "description": (
                    "Possible " + category.lower()
                    + " indicators found on the website."
                ),
                "evidence": matched
            })

    pre = [
        (p["label"] or p["hint"])
        for p in (preselected or [])
        if re.search(RISKY_CHECKBOX, (p["label"] + " " + p["hint"]).lower())
    ]
    if pre:
        detected.append({
            "pattern": "Preselected Options",
            "description": "Possible preselected options found on the website.",
            "evidence": pre
        })

    return detected


@app.route("/api/scan", methods=["POST"])
def scan_website():
    try:
        data = request.get_json(silent=True) or {}
        url = data.get("url", "").strip()

        if not url:
            return jsonify({
                "success": False,
                "message": "Please enter a website URL."
            }), 400

        if not validate_url(url):
            return jsonify({
                "success": False,
                "message": "Please enter a valid public website URL."
            }), 400

        html = fetch_website(url)

        extractor = WebsiteTextExtractor()
        extractor.feed(html)
        website_text = " ".join(extractor.text)

        results = detect_dark_patterns(
            website_text, extractor.preselected, extractor.ad_markers
        )
        source = "visible page text"

        # Fallback for JavaScript-heavy sites: scan the raw HTML too
        if not results:
            results = detect_dark_patterns(html)
            source = "raw page source (JavaScript-heavy site)"

        if not website_text and not results:
            return jsonify({
                "success": False,
                "message": "No readable website content was found."
            }), 422

        if results:
            message = (
                "Possible dark patterns were detected. "
                "Please review the findings."
            )
        else:
            message = (
                "No known dark pattern indicators were detected "
                "in the extracted website text."
            )

        return jsonify({
            "success": True,
            "url": url,
            "message": message,
            "total_detected": len(results),
            "results": results,
            "scanned": source,
            "note": (
                "This is a rule-based prototype. "
                "Results are indicators, not proof of deceptive design."
            )
        })

    except Exception:
        return jsonify({
            "success": False,
            "message": (
                "Unable to scan this website. "
                "It may be unavailable or block automated access."
            )
        }), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)