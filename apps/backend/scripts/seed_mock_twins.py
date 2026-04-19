"""Seed mock digital twins so the swarm has data without real Knot links.

Inserts 12 diverse archetype twins directly into the `twins` table and links
them to the first merchant (so they show up in /preset-for-customer lookups).

Run from repo root:
    uv run --project apps/backend python apps/backend/scripts/seed_mock_twins.py

Idempotent: dedupes by display_name, skips twins already present.
"""
from __future__ import annotations

import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Allow "from db import supa" when run from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import supa  # noqa: E402


ARCHETYPES = [
    {
        "display_name": "Prime Optimizer",
        "price_sensitivity": "mid",
        "top_products": [
            "AmazonBasics Microfiber Cloths",
            "Tide Pods Original",
            "Brita Pitcher Replacement Filter",
            "Bounty Select-A-Size Paper Towels",
            "Duracell AA Batteries 24-Pack",
            "Scotch Heavy Duty Packaging Tape",
        ],
        "top_sellers": ["Amazon.com", "AmazonBasics", "Procter & Gamble"],
        "payment_mix": {"CREDIT_CARD": 42, "GIFT_CARD": 2},
        "txn_count": 44,
        "avg_ticket_cents": 3400,
        "total_spend_cents": 149600,
        "discount_rate": 0.18,
        "persona_doc": (
            "This shopper is a household operations manager running a tight logistics "
            "loop through Amazon Prime. The cart is overwhelmingly consumables and "
            "commodity supplies — paper towels, laundry pods, replacement filters, "
            "batteries, tape — repurchased on what looks like a monthly cadence. "
            "Ticket sizes cluster in the $25-45 band and the discount rate sits near "
            "18%, suggesting they clip the occasional Subscribe & Save deal but aren't "
            "deal-hunting obsessively. They default to AmazonBasics when a reputable "
            "name brand isn't meaningfully better, which signals trust in Amazon as a "
            "category curator rather than loyalty to specific brands. Shopping is "
            "functional, not aspirational: they buy to replenish, not to explore. "
            "Seasonality is flat — the same staples show up year-round. Payment is "
            "almost entirely a single credit card with occasional gift card top-ups, "
            "reinforcing the routine feel. The standout quirk is bulk-pack bias: "
            "24-packs, family-size, multi-unit cases dominate, so per-unit price is "
            "clearly a mental model even when the headline ticket looks mid-range. A "
            "marketer should treat this person as someone who values storefront speed, "
            "clear comparison, and a minimum of friction — flashy urgency and novelty "
            "framing will read as noise, not value."
        ),
    },
    {
        "display_name": "Weekend Tinkerer",
        "price_sensitivity": "low",
        "top_products": [
            "DeWalt 20V MAX Drill Kit",
            "Makita Impact Driver",
            "Knipex Pliers Set",
            "Fluke Digital Multimeter",
            "Raspberry Pi 5 8GB",
            "Arduino Uno R4 WiFi",
            "Soldering Iron Station Hakko",
        ],
        "top_sellers": ["Adorama", "Adafruit", "Home Depot", "Amazon.com"],
        "payment_mix": {"CREDIT_CARD": 28},
        "txn_count": 28,
        "avg_ticket_cents": 12400,
        "total_spend_cents": 347200,
        "discount_rate": 0.07,
        "persona_doc": (
            "A serious hobbyist who treats their workbench like an investment portfolio. "
            "Purchases lean heavily toward top-tier tool brands — DeWalt, Makita, "
            "Knipex, Fluke, Hakko — with almost no private-label or budget picks. "
            "Tickets average north of $120 and the discount rate barely scrapes 7%, "
            "which says they buy when they need the tool, not when it's on sale. "
            "Electronics hobby gear (Raspberry Pi, Arduino, breakout boards) shows up "
            "alongside hand tools, suggesting maker/engineering projects rather than "
            "pure home repair. They source from specialty vendors (Adafruit, Adorama) "
            "when the mainline marketplace doesn't carry what they want, which marks "
            "them as a researched buyer rather than a passive one. Cadence is bursty: "
            "two or three orders in a weekend, then nothing for a few weeks, consistent "
            "with project-driven buying. Quality and precision language resonates; "
            "value framing and sale badges will feel cheap. A storefront targeting "
            "this shopper should lead with specs, provenance, and editorial tone — "
            "not deals."
        ),
    },
    {
        "display_name": "Coupon Archaeologist",
        "price_sensitivity": "high",
        "top_products": [
            "Kirkland Paper Towels",
            "Clorox Disinfecting Wipes",
            "Great Value Laundry Detergent",
            "Store Brand Trash Bags",
            "Huggies Snug & Dry Diapers",
            "Kraft Mac & Cheese 12-Pack",
        ],
        "top_sellers": ["Walmart", "Target", "Amazon.com", "Costco"],
        "payment_mix": {"CREDIT_CARD": 31, "GIFT_CARD": 9, "STORE_CREDIT": 3},
        "txn_count": 43,
        "avg_ticket_cents": 2100,
        "total_spend_cents": 90300,
        "discount_rate": 0.62,
        "persona_doc": (
            "Shopping behavior that screams active deal-hunting: 62% of orders carry "
            "a discount line, average ticket is just $21, and private-label staples "
            "dominate every category. Kirkland, Great Value, and generic store brands "
            "outnumber name brands nearly three to one. Payment mix includes "
            "recurring gift card and store credit redemptions, consistent with "
            "someone running a rewards-and-cashback stack across multiple retailers. "
            "Purchases cluster in family-household categories — diapers, cleaning "
            "supplies, frozen meals — which hints at a budget-conscious parent. They "
            "spread the same category across Walmart, Target, Amazon and Costco, "
            "which is classic price-compare behavior. No premium or aspirational "
            "brands appear anywhere in the history. The standout quirk is discount "
            "specificity: they take percent-off deals, not loyalty perks, so a "
            "storefront that advertises concrete savings ('20% off') will outperform "
            "one that advertises experience or quality. Urgency language, sale "
            "badges, and side-by-side price framing are the levers that move this "
            "shopper. Luxury framing will bounce."
        ),
    },
    {
        "display_name": "Editorial Minimalist",
        "price_sensitivity": "low",
        "top_products": [
            "Muji Passport Case",
            "Aesop Resurrection Aromatique Hand Wash",
            "Le Labo Santal 33 Body Lotion",
            "Everlane Oxford Shirt",
            "COS Wool Blend Coat",
            "Hay Glass Vase",
            "Kinto Coffee Carafe",
        ],
        "top_sellers": ["Muji", "Aesop", "Everlane", "COS", "Hay"],
        "payment_mix": {"CREDIT_CARD": 19},
        "txn_count": 19,
        "avg_ticket_cents": 8600,
        "total_spend_cents": 163400,
        "discount_rate": 0.05,
        "persona_doc": (
            "A curated buyer whose cart reads like a Kinfolk mood board: Muji, Aesop, "
            "Le Labo, Everlane, COS, Hay, Kinto. The brand list alone signals someone "
            "who values restraint, material quality, and design consistency over "
            "novelty or price. Ticket sizes average $86 and the discount rate is only "
            "5%, which means they buy at full price from brands they've already "
            "vetted — classic low-frequency, high-consideration shopping. Categories "
            "skew toward apparel basics, home objects, and personal care in neutral "
            "palettes. Nothing in the history looks impulsive or trend-chasing; "
            "everything feels like a considered addition to an existing system. They "
            "don't bounce between retailers — they return to the same four or five "
            "direct-to-consumer brands, which says brand loyalty is high but "
            "narrowly scoped. Seasonality shows up mildly (a coat purchase in fall, "
            "lighter layers in spring) but no sale-timed spikes. A marketer reaching "
            "this shopper should match their tone: calm typography, unhurried copy, "
            "emphasis on materials and provenance. Anything loud, urgent, or discount-"
            "forward will feel off-brand and get ignored."
        ),
    },
    {
        "display_name": "Quiet Luxe",
        "price_sensitivity": "low",
        "top_products": [
            "Loro Piana Cashmere Sweater",
            "The Row Pleated Trousers",
            "Bottega Veneta Intrecciato Wallet",
            "Diptyque Baies Candle",
            "Byredo Mojave Ghost Eau de Parfum",
            "Officine Universelle Buly Hand Cream",
        ],
        "top_sellers": ["Loro Piana", "The Row", "Bergdorf Goodman", "Mr Porter"],
        "payment_mix": {"CREDIT_CARD": 14},
        "txn_count": 14,
        "avg_ticket_cents": 47500,
        "total_spend_cents": 665000,
        "discount_rate": 0.02,
        "persona_doc": (
            "A premium shopper whose cart is almost entirely quiet-luxury labels: "
            "Loro Piana, The Row, Bottega Veneta, Diptyque, Byredo, Buly. Only 14 "
            "transactions in the window but an average ticket of $475 — low "
            "frequency, very high basket. The discount rate is effectively zero, "
            "meaning price is not a variable in the buying decision. They shop at "
            "heritage retailers (Bergdorf, Mr Porter) and directly with the brand "
            "sites, never marketplaces. Category mix skews apparel, fragrance, and "
            "small leather goods — no tech, no commodity purchases, nothing "
            "utilitarian. Payments run on a single credit card with no gift card or "
            "store credit activity, reinforcing the impression of a shopper who "
            "doesn't chase rewards. The standout quirk is unconspicuous taste: no "
            "logo-forward items, no collabs, no streetwear. Everything is understated "
            "but materially excellent. A storefront targeting this shopper should "
            "lean into craftsmanship, provenance, and scarcity language — 'one of 200 "
            "pieces,' 'woven in Biella.' Any mention of sale, discount, or bundle will "
            "actively repel them."
        ),
    },
    {
        "display_name": "Impulse Scroller",
        "price_sensitivity": "mid",
        "top_products": [
            "Stanley Quencher Tumbler 40oz",
            "Charlotte Tilbury Pillow Talk Lipstick",
            "Rare Beauty Soft Pinch Blush",
            "Crocs Classic Clog",
            "Dyson Airwrap Attachment",
            "Sol de Janeiro Brazilian Bum Bum Cream",
            "Glossier Balm Dotcom",
        ],
        "top_sellers": ["TikTok Shop", "Sephora", "Ulta", "Amazon.com"],
        "payment_mix": {"CREDIT_CARD": 52, "APPLE_PAY": 18, "AFTERPAY": 9},
        "txn_count": 79,
        "avg_ticket_cents": 2800,
        "total_spend_cents": 221200,
        "discount_rate": 0.31,
        "persona_doc": (
            "High-frequency, trend-driven shopping: 79 transactions with an average "
            "ticket of just $28. The cart is a near-perfect snapshot of viral social "
            "commerce — Stanley cup, Rare Beauty blush, Sol de Janeiro, Dyson "
            "attachments, Charlotte Tilbury Pillow Talk. Purchases happen in bursts "
            "aligned with what's trending, and the retailer mix includes TikTok Shop "
            "alongside Sephora and Ulta. Payment split across credit card, Apple Pay, "
            "and Afterpay (9 out of 79 tickets on buy-now-pay-later) points to a "
            "shopper optimizing for speed of checkout, not deliberation. Discount "
            "rate is 31% — they'll take a sale when it's pushed but they're not "
            "waiting for one. Category mix is almost entirely beauty, small gadgets, "
            "and trend apparel; nothing that would anchor as an investment purchase. "
            "Seasonality is driven by what's going viral, not by calendar events. "
            "The standout quirk is social-proof sensitivity: they buy what everyone "
            "else is buying, which means storefronts that surface 'bestseller' and "
            "'trending' signals will convert hard. Bold colors, animated badges, "
            "and urgency countdowns land cleanly; restrained editorial framing will "
            "underperform."
        ),
    },
    {
        "display_name": "Fitness Stacker",
        "price_sensitivity": "mid",
        "top_products": [
            "Optimum Nutrition Gold Standard Whey",
            "Legion Pulse Pre-Workout",
            "MyProtein Creatine Monohydrate",
            "RXBAR Chocolate Sea Salt 12-Pack",
            "Theragun Mini",
            "Lululemon Align Leggings",
            "Hydro Flask 32oz",
        ],
        "top_sellers": ["Amazon.com", "GNC", "Lululemon", "MyProtein"],
        "payment_mix": {"CREDIT_CARD": 36, "APPLE_PAY": 8},
        "txn_count": 44,
        "avg_ticket_cents": 5200,
        "total_spend_cents": 228800,
        "discount_rate": 0.24,
        "persona_doc": (
            "A consistent fitness-and-wellness shopper stacking supplements, "
            "activewear, and recovery gear on a predictable cadence. Whey, creatine, "
            "pre-workout, and protein bars repurchase every 30-45 days, which "
            "signals active training rather than casual interest. Ticket sizes "
            "average $52 and the discount rate is 24% — they'll wait for a "
            "MyProtein flash sale or stack a Lululemon members-only drop, but they "
            "won't cheap out on the core stack. The brand list mixes price-forward "
            "supplement names (Legion, MyProtein) with premium apparel (Lululemon) "
            "and recovery hardware (Theragun), which reads as someone who "
            "compartmentalizes budget by category. Payment is credit card plus "
            "Apple Pay for on-the-go reorders. No luxury or aspirational brands "
            "appear, and nothing in the cart looks impulsive. The standout quirk is "
            "loyalty program behavior: repeat visits to GNC and MyProtein suggest "
            "they're cashing in points and tier benefits. A storefront pitching this "
            "shopper should emphasize performance claims, bundle pricing, and "
            "loyalty perks. Pure luxury framing or commodity value framing both miss."
        ),
    },
    {
        "display_name": "Modern Parent",
        "price_sensitivity": "mid",
        "top_products": [
            "Pampers Swaddlers Size 3",
            "UPPAbaby Vista V2 Stroller",
            "Lovevery Play Kit",
            "Owlet Dream Sock",
            "Hatch Rest Sound Machine",
            "Dr. Brown's Options+ Bottles",
            "Melissa & Doug Wooden Puzzles",
        ],
        "top_sellers": ["Amazon.com", "Target", "Babylist", "Lovevery"],
        "payment_mix": {"CREDIT_CARD": 38, "GIFT_CARD": 6},
        "txn_count": 44,
        "avg_ticket_cents": 6800,
        "total_spend_cents": 299200,
        "discount_rate": 0.14,
        "persona_doc": (
            "A first-time-ish parent outfitting a young kid with a blend of premium "
            "and practical picks. UPPAbaby, Lovevery, Owlet, Hatch — the premium "
            "baby-tech list — sits alongside commodity diapers and bottles. Average "
            "ticket is $68 and discount rate is only 14%, which suggests trust-led "
            "buying: they read Babylist reviews, pick the recommended SKU, and "
            "don't spend much time comparison-shopping. Category mix is almost "
            "entirely baby and early-childhood. Retailers include specialty baby "
            "stores (Babylist) alongside mainstream (Target, Amazon), consistent with "
            "a buyer who uses registries and curated lists rather than open "
            "browsing. Payment shows gift card usage, likely from baby shower "
            "inventory. No adult luxury, no hobby spend, no trend beauty — life "
            "stage is clearly dominant. The standout quirk is safety-signal "
            "sensitivity: Owlet, monitors, BPA-free bottles all weighted toward "
            "peace-of-mind framing. A storefront should lead with safety, pediatric "
            "endorsements, and 'top picks for parents' curation. Urgency and "
            "discount-forward framing will feel out of place; editorial or trust-led "
            "framing will convert."
        ),
    },
    {
        "display_name": "Plant Mom",
        "price_sensitivity": "mid",
        "top_products": [
            "Monstera Deliciosa 4-inch",
            "FoxFarm Ocean Forest Potting Soil",
            "Terra-Cotta Pots Variety Pack",
            "Haws Brass Watering Can",
            "Mars Hydro TS 1000 Grow Light",
            "Ortho Insect Killer",
            "Philodendron Pink Princess Cutting",
        ],
        "top_sellers": ["The Sill", "Etsy", "Amazon.com", "Home Depot"],
        "payment_mix": {"CREDIT_CARD": 31, "PAYPAL": 7},
        "txn_count": 38,
        "avg_ticket_cents": 3900,
        "total_spend_cents": 148200,
        "discount_rate": 0.11,
        "persona_doc": (
            "A hobbyist houseplant collector whose cart moves between big-box garden "
            "supplies and specialty propagation marketplaces. Rare philodendron "
            "cuttings from Etsy sellers sit next to commodity potting soil and "
            "terra-cotta pots. Average ticket is $39 and discount rate is low at "
            "11%, which fits someone paying premium for specific cultivars but "
            "commodity pricing for substrate and tooling. Grow lights and humidity "
            "equipment suggest a serious setup, not a casual window-sill hobby. "
            "Payment includes PayPal, typical of Etsy marketplace purchases. "
            "Seasonality shows spring and fall spikes aligning with planting "
            "seasons. The category is narrow but deep — almost everything in the "
            "window is plant-related, with occasional home decor crossovers (brass "
            "watering can, Hay ceramics in past orders). The standout quirk is "
            "cultivar specificity: they search for named varieties, not 'house "
            "plant.' A storefront targeting this shopper should lean into "
            "taxonomy, care guides, and seasonal merchandising. Generic plant "
            "imagery and blanket discounts will underperform versus variety-specific "
            "storytelling."
        ),
    },
    {
        "display_name": "Road Warrior",
        "price_sensitivity": "mid",
        "top_products": [
            "Away Bigger Carry-On",
            "Bose QuietComfort Ultra Earbuds",
            "Anker 737 Power Bank",
            "Peak Design Travel Tripod",
            "Patagonia Black Hole Duffel",
            "Tumi Passport Case",
            "Sony WH-1000XM5 Headphones",
        ],
        "top_sellers": ["Away", "Bose", "Amazon.com", "REI", "Peak Design"],
        "payment_mix": {"CREDIT_CARD": 26, "APPLE_PAY": 5},
        "txn_count": 31,
        "avg_ticket_cents": 11200,
        "total_spend_cents": 347200,
        "discount_rate": 0.09,
        "persona_doc": (
            "A frequent traveler whose cart is dominated by durable, "
            "high-performance travel and tech gear. Bose, Sony, Peak Design, Tumi, "
            "Patagonia, Away — every purchase is a category leader, and tickets "
            "average $112 with only a 9% discount rate. Nothing looks impulsive; "
            "everything looks bought with intent for specific use. The retailer mix "
            "includes direct-to-consumer travel brands (Away, Peak Design) alongside "
            "REI and mainstream marketplaces. Payment defaults to a single credit "
            "card with occasional Apple Pay for on-the-road purchases. Seasonality "
            "is flat, consistent with year-round travel rather than vacation-driven "
            "spikes. Nothing in the cart suggests family or household spending — "
            "it's self-directed, functional-premium buying. The standout quirk is "
            "upgrade cycles: headphones, power banks, and luggage show refresh "
            "patterns every 18-24 months, suggesting they replace gear when better "
            "versions ship rather than when the old one fails. A storefront should "
            "emphasize performance specs, travel-tested durability, and "
            "peer-reviewed quality. Generic luxury framing or budget framing both "
            "miss — this shopper wants the best working tool."
        ),
    },
    {
        "display_name": "Indie Reader",
        "price_sensitivity": "mid",
        "top_products": [
            "Moleskine Classic Notebook Large",
            "Lamy Safari Fountain Pen",
            "Rhodia No. 16 Notepad",
            "Sally Rooney - Beautiful World, Where Are You",
            "Percival Everett - James",
            "Tana French - The Hunter",
            "Leuchtturm1917 Medium",
        ],
        "top_sellers": ["Bookshop.org", "Powell's Books", "Amazon.com", "JetPens"],
        "payment_mix": {"CREDIT_CARD": 22},
        "txn_count": 22,
        "avg_ticket_cents": 4100,
        "total_spend_cents": 90200,
        "discount_rate": 0.08,
        "persona_doc": (
            "A reading-and-writing hobbyist who buys literary fiction, stationery, "
            "and analog writing tools on a steady cadence. Current fiction (Sally "
            "Rooney, Percival Everett, Tana French) mixes with notebooks and "
            "fountain pens — the full analog stack. Average ticket is $41 and "
            "discount rate is 8%, which says they buy at list price at indie "
            "retailers rather than waiting for marketplace deals. Bookshop.org and "
            "Powell's appearing in the top sellers is a clear signal: this person "
            "actively routes spend away from Amazon when they can. JetPens for "
            "stationery reinforces the specialty-retailer pattern. Nothing in the "
            "cart is trendy or status-driven; everything is tactile and slow. "
            "Seasonality is flat but quiet spikes around major publication dates. "
            "Payment is a single credit card with no BNPL or gift card activity. "
            "The standout quirk is anti-algorithm behavior: they're opting out of "
            "the recommendation treadmill and buying curated picks. A storefront "
            "targeting this shopper should lean into editorial, curation, and "
            "long-form context — staff picks, author interviews, craft backstory. "
            "Big banners and flash sales will feel crass."
        ),
    },
    {
        "display_name": "Gaming Enthusiast",
        "price_sensitivity": "mid",
        "top_products": [
            "Logitech G Pro X Superlight 2 Mouse",
            "Keychron Q1 Pro Mechanical Keyboard",
            "LG 27GR95QE-B OLED Monitor",
            "SteelSeries Arctis Nova Pro",
            "Elden Ring: Shadow of the Erdtree",
            "PlayStation 5 DualSense Edge Controller",
            "Kingston Fury Renegade NVMe 2TB",
        ],
        "top_sellers": ["Amazon.com", "Best Buy", "Newegg", "Steam"],
        "payment_mix": {"CREDIT_CARD": 33, "PAYPAL": 5, "STEAM_WALLET": 12},
        "txn_count": 50,
        "avg_ticket_cents": 7300,
        "total_spend_cents": 365000,
        "discount_rate": 0.22,
        "persona_doc": (
            "A PC and console gamer whose cart balances hardware upgrades with "
            "software purchases. Peripherals dominate — G Pro X Superlight, Keychron "
            "Q1 Pro, Arctis Nova Pro, OLED gaming monitor — alongside NVMe storage "
            "upgrades and current AAA titles. Average ticket is $73 and discount "
            "rate is 22%, reflecting a mix of list-price peripheral buying and "
            "Steam sale participation. Payment split is telling: credit card for "
            "hardware, Steam wallet balance for games, PayPal for marketplace "
            "Newegg purchases. Retailers span Best Buy and Newegg alongside Amazon, "
            "which says they'll price-compare on big-ticket hardware but convenience-"
            "buy smaller items. No luxury or lifestyle brands appear — spend is "
            "almost entirely gaming-adjacent tech. Seasonality shows spikes around "
            "major game releases (Elden Ring DLC window, holiday launches). The "
            "standout quirk is sensor specificity: mouse and keyboard choices point "
            "to a shopper who reads reviews about polling rates and switch types. "
            "A storefront should emphasize specs, reviewer consensus, and bundle "
            "value. Editorial luxury framing will miss entirely; performance "
            "framing and comparison tables will convert."
        ),
    },
]


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _make_raw_summary(arch: dict) -> dict:
    latest = datetime.now(timezone.utc) - timedelta(days=random.randint(0, 5))
    earliest = latest - timedelta(days=random.randint(90, 270))
    return {
        "txn_count": arch["txn_count"],
        "total_spend_cents": arch["total_spend_cents"],
        "avg_ticket_cents": arch["avg_ticket_cents"],
        "discount_rate": arch["discount_rate"],
        "top_products": arch["top_products"],
        "top_sellers": arch["top_sellers"],
        "payment_mix": arch["payment_mix"],
        "date_range": {"earliest": _iso(earliest), "latest": _iso(latest)},
        "sample_raw": [],
        "mock": True,
    }


def main() -> None:
    db = supa()

    merchant_resp = db.table("merchants").select("id,shop").limit(1).execute()
    if not merchant_resp.data:
        raise SystemExit(
            "No merchant row found. Install the app on at least one store "
            "before seeding twins."
        )
    merchant = merchant_resp.data[0]
    merchant_id = merchant["id"]
    shop = merchant["shop"]

    existing_resp = db.table("twins").select("display_name").execute()
    existing_names = {row["display_name"] for row in (existing_resp.data or [])}

    inserted: list[tuple[str, str]] = []
    for arch in ARCHETYPES:
        if arch["display_name"] in existing_names:
            print(f"skip (exists): {arch['display_name']}")
            continue

        summary = _make_raw_summary(arch)
        twin_payload = {
            "source_session_id": f"mock-{arch['display_name'].lower().replace(' ', '-')}",
            "source_merchant": "amazon",
            "raw_txn_count": arch["txn_count"],
            "raw_summary": summary,
            "persona_doc": arch["persona_doc"],
            "display_name": arch["display_name"],
            "price_sensitivity_hint": arch["price_sensitivity"],
        }
        twin_resp = db.table("twins").insert(twin_payload).execute()
        twin_id = twin_resp.data[0]["id"]

        db.table("customer_twin_link").upsert(
            {
                "merchant_id": merchant_id,
                "shopify_customer_id": f"mock-{twin_id[:8]}",
                "twin_id": twin_id,
            },
            on_conflict="merchant_id,shopify_customer_id",
        ).execute()

        inserted.append((arch["display_name"], twin_id))
        print(f"inserted: {arch['display_name']} -> {twin_id}")

    print(f"\nDone. {len(inserted)} new twin(s) linked to merchant {shop}.")
    if inserted:
        print("\nNext: run the swarm to score them against the 4 presets:")
        print(f"  curl -X POST http://localhost:8000/swarm/run -H 'Content-Type: application/json' \\")
        print(f"    -d '{{\"shop\": \"{shop}\", \"kind\": \"full\"}}'")


if __name__ == "__main__":
    main()
