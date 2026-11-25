# External benchmark sources for Shotwise (research notes)

**Purpose:** Roadmap §7 ("External golf performance benchmarks", PR 15) asks which external golf performance datasets could be shown as optional overlays in club profiles, and under what licensing. This file documents primary-source research done on **2026-11-25**. Every claim cites a primary URL (official page, official terms, official publication); anything that could not be verified from a primary source is marked **UNVERIFIED**.

**What Shotwise measures (measurement basis):** Shotwise imports Inrange Golf range CSV exports. Per Inrange's own FAQ, in *range ball* mode the shown trajectory is the true (limited-flight) trajectory of the range ball; in *premium ball* mode "the trajectory is converted to adjust for limited-flight properties of range balls… developed through thousands of comparisons with premium golf balls". Total distance is carry "plus a modelled bounce and roll", and "flat carry / flat total" correct for elevated bays. Source: https://www.inrangegolf.com/players/faqs (CSV export download links are on the same page). In the Shotwise codebase these appear as `Carry Dist. Range`, `Carry Dist. Premium`, flat-carry variants, total distance, ball speed and launch columns (`app/src/domain/csv.ts`).

---

## Summary and recommendation

**No candidate source was found whose terms clearly permit embedding its dataset inside the app.** Every major source (Shot Scope, Arccos, TrackMan, PGA TOUR, LPGA, publishers) reserves its content/data and allows at most personal, non-commercial viewing, linking, or brief quotation with attribution. Two sources have formal data-licensing programs (Arccos On-Course Data API; PGA TOUR ShotLink academic license), but both are commercial or academic-only and neither grants redistribution of aggregate benchmark tables into a third-party app. The USGA/R&A research PDFs are publicly downloadable and are the best *measurement-compatible* sources (launch-monitor, range/lab testing), but no explicit redistribution license was found for them either.

**Recommendation: link-out benchmarks with attribution + optional user-entered reference values; do not embed any third-party dataset without a written license.** The strongest link-out candidates are the Arccos Annual Driving Distance Report (amateur driver distance by handicap/age/gender, on-course total distance) and Shot Scope's in-app handicap benchmarks (on-course club distances), with TrackMan Tour Averages and PGA TOUR/LPGA stats as clearly-labelled professional reference links only.

| Source | What it could benchmark | License verdict | Why |
|---|---|---|---|
| Shot Scope (handicap benchmarks, club distances in app) | Amateur club distances & strokes gained by handicap | **Link-only** | Site T&C §5.2–5.6: all IP reserved; "You must not use any part of the materials on Our Site for commercial purposes without obtaining a licence" (https://shotscope.com/us/terms-and-conditions/). No public dataset or API found. |
| Arccos Annual Driving Distance Report | Amateur **driver** distance by handicap, age, gender | **Link-only** | Website Terms §2.1: personal non-commercial use only; "must not reproduce, distribute, modify, create derivative works of… any of the material" (https://www.arccosgolf.com/pages/website-terms-of-use). On-Course Data API is a paid per-user commercial license, not an open dataset. |
| TrackMan Tour Averages (PGA/LPGA) | Pro club speed, ball speed, spin, **carry** per club | **Link-only** | Trackman terms: except standard Media Kit materials, no use of Trackman copyrights/trademarks "without our prior written permission" (https://www.trackman.com/legal/terms-and-conditions). Pro on-course/range mix — must not be presented as an amateur target. |
| PGA TOUR stats (pgatour.com) | Pro driving distance, strokes gained, etc. | **Link-only** | Terms §7(A)/(C)/(H): personal non-commercial use only; no scraping of statistics; no copying/redistribution (https://www.pgatour.com/company/terms-of-use). ShotLink academic license is not-for-profit research only (https://www.pgatour.com/stats/academicdata/shotlink.html). |
| LPGA stats (lpga.com) | Pro women's driving distance etc. | **Link-only** | Website Terms: "we own all right, title and interest… prohibited from copying, reproducing, modifying…"; non-commercial use only (https://www.lpga.com/terms-and-conditions). |
| USGA/R&A research PDFs (R22-01, R22-10, Distance Insights) | Amateur launch conditions by skill level; range distance/accuracy testing | **Link-only (no redistribution license found — UNVERIFIED)** | PDFs publicly downloadable from usga.org, but site terms reserve rights (https://www.usga.org/content/usga/home-page/terms-and-conditions.html); no explicit permission to embed tables in an app found. Best measurement compatibility (launch monitor, range setting). |
| Golf Digest Hot List player testing | Club-model distance at the range (equipment, not population) | **Link-only** | Condé Nast content; not a handicap-population benchmark. |
| MyGolfSpy club-distance chart | Republished Shot Scope by-handicap distances | **Link-only** | Their terms: "you may not: republish or redistribute our articles…"; "You may share links and quote brief excerpts with attribution and a link back" (https://mygolfspy.com/terms-of-use/). Underlying data is Shot Scope's. |
| Lou Stagner / "Decoding Golf" newsletter (Arccos data) | Strokes gained / scoring by handicap | **Link-only** | Substack ToS prohibits copying others' content (https://substack.com/tos); data is Arccos IP. |
| Broadie / Every Shot Counts / ShotLink raw data | Pro strokes-gained research | **Not available** | No public dataset; ShotLink academic license is not-for-profit only; book data not released. |
| Academic open datasets (e.g. CaddieSet) | None suitable | **Not suitable** | Tiny lab samples (e.g. 924 shots), license UNVERIFIED; not population benchmarks. |

---

## 1. Shot Scope

**What exists (primary sources):**
- In-app **handicap benchmarks for Strokes Gained** and club distances. Marketing/features pages: "Benchmark against different handicap ranges to see how your game stacks up against the averages" (https://shotscope.com/us/discover/features/); club distances in the app/dashboard with three user-selectable data sets — "longest, average, and Performance-Average (P-AVG)… excludes outliers from the dataset, both good and bad" (https://shotscope.com/us/discover/features/traditional-golf-statistics/; P-AVG definition also at https://h4support.shotscope.com/hc/en-us/articles/11245176283537-What-is-the-P-AVG-Performance-Average-Distance).
- Methodology statement: when handicap benchmarking was released, "the baseline statistics used will not come from the Tour, but will be generated from all existing shots within the Shot Scope database (80+ million)" (https://shotscope.com/blog/practice-green/stats-and-data/understanding-strokes-gained/ ; same statement in https://support.shotscope.com/hc/en-us/articles/360017684917-What-is-strokes-gained).

**Checklist:**
- Source + publication date: Shot Scope app/web product feature; strokes-gained benchmarking released ~2021 (blog post, exact date UNVERIFIED from primary page fetch); pages current as of 2026-11-25.
- Sample size: "80+ million" shots in the Shot Scope database cited for baselines (blog above). **UNVERIFIED** for the current database size; no per-handicap sample sizes published on the website.
- Population: Shot Scope sensor/watch users, **on-course** rounds (GPS + club sensors).
- Club type: all clubs (club distances in app); strokes gained by area (tee/approach/short game/putting).
- Units: yards/metres per user settings — **UNVERIFIED** from primary source.
- Carry vs total: **UNVERIFIED** from a primary Shot Scope page whether app club distances are carry or total (GPS-based tracking typically measures shot distance as the crow flies to the landing/resting area, i.e. closer to total; the website does not state it). Mark UNVERIFIED — must not be assumed comparable to Inrange carry.
- Averages vs percentiles: offers longest / average / P-AVG (outlier-excluded average, both good and bad outliers removed) — a filtered statistic, not a pure mean or percentile.
- Range vs course: course (rounds). Range data may exist in-app for range sessions — **UNVERIFIED**.
- Comparability to Inrange: on-course, sensor-derived distances; not range-ball carry and not premium-ball-estimated carry. Not directly comparable; at best a "same-population, different-venue" reference.
- Terms of use / redistribution: Terms & Conditions, clauses 5.2–5.7: "We are the owner and the licensor of all intellectual property rights in Our Site… All such rights are reserved." / "You may print off one copy… for your personal reference" / "**You must not use any part of the materials on Our Site for commercial purposes without obtaining a licence to do so from us as the licensors.**" (clause 5.6) — https://shotscope.com/us/terms-and-conditions/ (legal hub: https://shotscope.com/us/legal/). No public API or open dataset found (dev.shotscope.com is the user dashboard). Third parties (e.g. MyGolfSpy) republish its by-handicap distances, but that does not grant us rights.

**Verdict: link-only.** Embedding Shot Scope benchmark tables would require a licence from Shot Scope.

## 2. Arccos Golf

**Publications (primary sources):**
- 2022 edition of the Annual Driving Distance Report, published 2023-03-22: "over 20 million driver shots… over 650 million shots tracked", filtered by age, handicap, gender — https://www.arccosgolf.com/blogs/community/arccos-2022-driving-distance-report
- 2025 edition (7th year): "more than 4 million rounds played by Arccos users worldwide in 2024"; "focuses exclusively on driver tee shots hit on par 4s and par 5s, automatically captured and verified through the Arccos platform. It analyzes **total driving yardages (carry plus rollout)** based on a random sample of **25,000 Arccos users and 6.5 million shots**"; cumulative "1.2 billion shots from 22 million rounds" — https://www.arccosgolf.com/blogs/community/arccos-announces-driving-distance-report
- 2026 edition (8th year), press release dated 2026-05-05/06: ">5 million rounds and nearly 10 million driver tee shots from 2025", cumulative ">1.5 billion shots across 25 million rounds played in more than 160 countries"; eight-year trend across age, gender and handicap (groups incl. scratch–4.9 … 30+) — https://www.arccosgolf.com/blogs/community/arccos-golf-releases-largest-ever-annual-driving-distance-report-leveraging-data-from-25-million-rounds-to-deliver-eight-year-trend-analysis-across-age-gender-and-skill-level

**Checklist:**
- Source + publication date: Arccos Annual Driving Distance Report, editions 2022 (2023-03-22), 2025, 2026 (2026-05-05/06) — URLs above.
- Sample size: stated per edition (20M driver shots in 2022 ed.; 25,000 users / 6.5M shots random sample in 2025 ed.; ~10M driver tee shots / >5M rounds in 2026 ed.).
- Population: Arccos members (self-selected users of Arccos sensors), worldwide, 160+ countries; amateur golfers. Not representative of all golfers (sensor-owner bias) — inherent to the source.
- Club type: **driver only** (tee shots on par 4s/par 5s); other clubs not in the public reports.
- Units: yards (US pages) — metres on regional pages.
- Carry vs total: **total distance (carry plus rollout)**, explicitly stated in the 2025 edition page above.
- Averages vs percentiles: report publishes averages by group (exact percentile tables inside the PDFs — UNVERIFIED from primary page text; PDF behind a bit.ly link, not fetched).
- Range vs course: **on course** (rounds tracked in the app).
- Comparability to Inrange: driver **total** on course ≈ comparable only to Inrange **total distance**, never to Inrange carry (range or premium). No carry figure is published by Arccos ("There's no way to measure pure carry with Arccos" — third-party quote, UNVERIFIED from Arccos primary). Ball speed/launch not in these reports.
- Terms of use / redistribution: Website Terms of Use (last updated 2022-02-16), §2.1: "the Website and its entire contents… are owned by Arccos Golf, its licensors, or other providers… Except for Permitted Professional Use or as otherwise permitted by a separate agreement with Arccos Golf, you may use the Website for your personal (non-commercial) use only. **You must not reproduce, distribute, modify, create derivative works of, publicly display, publicly perform, republish, download, store, or transmit any of the material on the Website or the App**"; automated scraping/bots prohibited — https://www.arccosgolf.com/pages/website-terms-of-use (verified via the identical CA mirror https://ca.arccosgolf.com/pages/website-terms-of-use; the www page blocks automated readers). Separately, the **Arccos On-Course Data API** is offered to approved companies under a commercial "API License and Data Access Agreement" (per-user SSO access to that user's own on-course data), launched April 2023 with Clippd — agreement PDF: https://cdn.arccosgolf.com/documents/on_course_data_api/Arccos+API+License+Agreement_FINAL_2.27.pdf ; announcement: https://www.arccosgolf.com/blogs/community/clippd-to-become-first-platform-to-seamlessly-integrate-arccos-on-course-data ; docs: https://www.postman.com/arccosgolf/arccos-public-api/documentation/twe2nps/arccos-on-course-data-api . This is a per-user data-access license, **not** a license to redistribute aggregate statistics.

**Verdict: link-only.** Best amateur by-handicap driver-distance source, but embedding requires a license from Arccos.

## 3. TrackMan Tour Averages (PGA TOUR / LPGA)

**Publications (primary sources):**
- Blog "New PGA & LPGA Tour Averages | Trackman Insights 2024": metrics are Club Speed, Ball Speed, Spin Rate and **Carry**. Methodology: "Male data is captured across 40+ different events and 200+ different players" at "both PGA TOUR and DP World Tour events"; "Female data… 30+ different events and 150+ different players… at both LPGA and LET events"; "**Averages are based on data from competition as well as on the range**"; driver shots on "official stat holes… picked going in opposite directions to reduce any effects from wind"; "less than 0.5 percent" non-driver shots possible — https://www.trackman.com/blog/introducing-updated-tour-averages (page title dates it to the 2024 "Insights" release; exact publication date not shown on page — UNVERIFIED).
- Downloadable PGA/LPGA Tour Averages posters (PDF/JPG, yards & metres): https://www.trackman.media/tour-averages ; in-product reference: https://support.trackmangolf.com/hc/en-us/articles/5089752464667-Shot-Analysis-Tour-Averages-On-PGA-LPGA-Tour ("average Club Speed, Carry Distance & Ball Speed from the PGA tour").

**Checklist:**
- Source + date: TrackMan Tour Averages, "Insights 2024" edition (2024; updated editions exist) — URLs above.
- Sample size: 200+ male players / 40+ events; 150+ female players / 30+ events (per blog). Shot counts per player UNVERIFIED.
- Population: professional tour players (PGA TOUR, DP World Tour, LPGA, LET). **Not amateurs.**
- Club type: every club in the bag (driver through wedges) on the posters.
- Units: yards or metres (download options).
- Carry vs total: **carry** (launch-monitor measured flight distance); total not published here.
- Averages: means per club.
- Range vs course: **mixed** — "competition as well as on the range" (driver: competition on official stat holes; other clubs largely range data — UNVERIFIED split per club).
- Comparability to Inrange: carry from a premium launch monitor in (partly) competition conditions. Closest external analogue to Inrange **premium-ball carry**, but for **tour professionals** — must NOT be shown to amateurs as a target or as "expected" performance (roadmap §7.4). Useful only as a clearly-labelled "PGA TOUR / LPGA reference" overlay.
- Terms of use: https://www.trackman.com/legal/terms-and-conditions — search-indexed clause: "Except for the standard materials provided through the Trackman Media Kit, you will not use Trackman's copyrights or trademarks… without our prior written permission." The Media Kit (https://www.trackman.media/) distributes brand assets and the tour-average posters for press/use with permission; **no license to embed the underlying numbers in a third-party app was found — UNVERIFIED whether a content license can be granted; treat as link-only.**

**Verdict: link-only; pro reference only.**

## 4. PGA TOUR official stats (pgatour.com) and ShotLink

**Primary sources:**
- Driving Distance stat: "The average distance (in yards) of a drive, regardless of whether the ball ended in the fairway or not. NOTE: This is only on 2 'measured' holes per course that are selected prior to the event." (2026 season tour average 305.1 yd through the RSM Classic) — https://www.pgatour.com/stats/detail/101 ; stats hub https://www.pgatour.com/stats
- USGA's Annual Driving Distance Reports (which compile tour driving distance from ShotLink): https://www.usga.org/content/usga/home-page/equipment-standards/notices-and-announcements-47d84789/driving-distance-reports.html

**Checklist:**
- Source + date: continuous season stats, pgatour.com (live 2026 season as of 2026-11-25).
- Sample size: per-player drive counts shown on the stat page (e.g. 138–186 measured drives for leaders) — only 2 measured holes per course per round.
- Population: PGA TOUR (and Champions/Korn Ferry) players. **Pros, on course.**
- Club type: driver (stat 101); other stats cover all clubs/areas.
- Units: yards.
- Carry vs total: **total distance** (tee to where the ball came to rest, includes roll) — "distance of a drive" per the definition above; pgatour.com does not publish an official carry stat. UNVERIFIED whether any carry stat exists on the site.
- Averages: season average per player + tour average.
- Range vs course: **course**, measured holes only.
- Comparability to Inrange: total on-course pro distance — **not comparable** to Inrange range carry or premium carry; do not overlay on amateur range data except as a clearly-labelled pro reference.
- Terms: Terms of Use (updated April 2024), §7(A): "PGATOUR.COM is intended for Your personal, noncommercial use only. You shall not use PGATOUR.COM or any of its data or other content for any commercial or business-related purpose, unless expressly licensed by PGATOUR.COM, LLC." §7(C) prohibits automated "monitor, copy or download… real time scoring, statistics… or any other data". §7(H): "You may not modify, publish, transmit… no copying, redistribution…" — https://www.pgatour.com/company/terms-of-use . ShotLink raw data: academic researchers may apply for a not-for-profit license — https://www.pgatour.com/stats/academicdata/shotlink.html (page body behind a cookie wall; the not-for-profit academic-license policy is described on the page and in PGA TOUR's own materials — exact clause text UNVERIFIED). Not available to a commercial app.

**Verdict: link-only; pro reference only.**

## 5. LPGA official stats (lpga.com)

- Driving stats page: "The average number of yards per measured drive" — https://www.lpga.com/stats-and-rankings/driving (page is JS-rendered; the one-line definition above is from the page's indexed description — partially verified). Stats hub: https://www.lpga.com/stats-and-rankings
- Checklist: same as PGA TOUR — pros, on course, total yards per measured drive, season averages. Carry/ball speed not published on the public site (TrackMan's LPGA tour averages cover carry).
- Terms: Website Terms of Use — "As between you and us, we own all right, title and interest" in the sites and content; "you are prohibited from copying, reproducing, modif[y]ing…"; "Organization maintains the Organization Sites for your personal [non-commercial use]… Any other use, including for any commercial purposes, is strictly prohibited without our express prior written consent" — https://www.lpga.com/terms-and-conditions

**Verdict: link-only; pro reference only.**

## 6. USGA / R&A equipment research (best measurement compatibility)

**Primary sources:**
- Technical Library for Equipment (lists all research reports): https://www.usga.org/content/usga/home-page/equipment-standards/technical-library-for-equipment.html
- Supplemental Reports index: https://www.usga.org/content/usga/home-page/equipment-standards/technical-library-for-equipment/research-links/supplemental-reports.html — lists e.g. "R22-01 Launch Conditions of Male and Female Golfers of Different Skill Levels" (2022) and "R22-10 Distance and accuracy range testing performance results".
- R22-01 PDF: https://www.usga.org/content/dam/usga/pdf/Equipment/R22-01%20Launch%20conditions%20of%20male%20and%20female%20golfers%20of%20different%20skill%20levels.pdf — indexed text: "driver of 93.8 ± 3.8 mph [female avg clubhead speed], compared to 113.7 ± 4.6 mph for the male golfers. Average clubhead speed generally increased with decreasing handicap… Similar patterns were observed in ball speed, but there did not appear to be any consistent relationship between handica[p and launch]…" (launch-monitor player testing of golfers grouped by skill/handicap).
- R22-10 PDF (13 pp): https://www.usga.org/content/dam/usga/pdf/Equipment/R22-10%20Distance%20and%20accuracy%20range%20testing%20performance%20results.pdf — indexed text: "In all, 68 male g[olfers]…"; "the average clubhead speed for all male participants was 110 MPH"; statistics "based on the first ten drives with the 'normal'… format" — i.e. **range testing with a launch monitor**, distance and accuracy.
- Distance Insights 2020 report (102 pp, USGA/R&A): https://www.usga.org/content/dam/usga/pdf/2020/distance-insights/DIPR-FINAL-2020-usga.pdf — includes TrackMan data on PGA TOUR players and cites a TrackMan publication that "the average distance of amateur male golfers is 214 yards" (legacy TrackMan blog: https://blog.trackmangolf.com/performance-of-the-average-male-amateur/ — cited within the USGA report; blog itself is a secondary publication, no dataset). Project page: https://www.usga.org/content/usga/home-page/advancing-the-game/distance-insights.html
- 2021 Distance Report (uses PGA TOUR ShotLink): https://www.usga.org/content/dam/usga/pdf/Equipment/2021%20Distance%20Report%20Final%2010-03-2022.pdf

**Checklist:**
- Source + date: USGA Equipment Standards research reports, R22 series (2022), Distance Insights (2020–2021). URLs above.
- Sample size: R22-10 snippet indicates 68 male participants (female cohort UNVERIFIED); R22-01 participant counts UNVERIFIED (PDF not directly fetchable — usga.org blocks automated access to PDFs; figures above come from the search index of the PDF text). These are small controlled studies, not population statistics.
- Population: recruited amateur golfers of different skill levels (handicap groups in R22-01), male/female; US-based testing. Not a representative national sample.
- Club type: driver (R22-01 launch conditions; R22-10 range distance/accuracy testing) — per-club iron/wedge distances by handicap not published. UNVERIFIED.
- Units: mph, yards (USGA reports).
- Carry vs total: launch-monitor **carry** and total both typically reported in range testing — exact split per report UNVERIFIED from direct fetch.
- Averages: means ± SD by skill group (per indexed text).
- Range vs course: **range/laboratory** (USGA Test Center) — the closest setting to Inrange range sessions.
- Comparability to Inrange: highest of all candidates — range-based, launch-monitor, premium balls, carry available. Still small samples and driver-focused, so useful as context, not as a full by-handicap club-distance table.
- Terms: usga.org pages block automated fetch (Access Denied), so clause text UNVERIFIED from direct read; the site publishes Terms and Conditions at https://www.usga.org/content/usga/home-page/terms-and-conditions.html (GHIN terms snippet: "Authorized User shall not remove, obscure or alter any copyright or trademark notices" — https://www.usga.org/content/usga/home-page/Handicap-ghin/ghin-terms-of-service.html). USGA has an explicit reuse policy for Green Section (turf) publications requiring permission from for-profit entities and retention of copyright notices — https://www.usga.org/content/usga/home-page/articles/2021/... (policy page indexed as "Policy for the Reuse of USGA Green Section Publications", usga.org …21474852131.html); by analogy, **no explicit license to embed USGA report tables in an app was found — treat as link-only unless USGA grants permission in writing (UNVERIFIED)**.

**Verdict: link-only by default; best candidate to *ask* for permission, because the measurement basis (range, launch monitor, carry) matches Inrange most closely.**

## 7. Other candidates examined

- **Golf Digest Hot List** — https://www.golfdigest.com/hot-list-2025 : "every full swing of our 32 player-testers is recorded by a launch monitor" (2025 testing used the Rapsodo MLM2 Pro — https://www.golfdigest.com/story/hot-list-favorites-more-distance-drivers); range data processing of ~20,000 shots with a Grubbs outlier test, shots <80% of a player's average treated as mishits — https://www.golfdigest.com/story/range-results--how-we-processed-shots . This is **equipment-model testing** (specific club heads), not amateur-population-by-handicap benchmarks → not suitable for the roadmap's purpose. Content is Condé Nast IP; app EULA states AP and other content "shall not be… redistributed" — https://www.golfdigest.com/story/app-user-license-agreement . **Link-only.**
- **MyGolfSpy club-distance chart** — https://mygolfspy.com/news-opinion/how-far-should-you-be-hitting-each-club-distance-data-you-should-know/ (2025-01-07) republishes "distance data from Shot Scope based on handicap for male golfers". MyGolfSpy Terms of Use: content "owned by MyGolfSpy or its licensors and protected by copyright, trademark, and other laws. We reserve all rights not e[xpressly granted]"; "you may not: republish or redistribute our articles, photographs, videos, or rankings, in whole…"; "**Testing data**… non-commercial use. You may share links and quote brief excerpts with attribution and a link back" — https://mygolfspy.com/terms-of-use/ . **Link-only (links + brief attributed quotes at most).**
- **Lou Stagner / "Decoding Golf" newsletter** — https://newsletter.loustagnergolf.com/ (Substack; e.g. #29 "Skill differences between different handicaps", #24 three-putt % by handicap, #37 performance by hole handicap) publishes Arccos-database tables by handicap. Substack Terms of Service prohibit copying content not owned by you — https://substack.com/tos ; the underlying data is Arccos IP (see §2). **Link-only.**
- **Broadie, "Every Shot Counts" / ShotLink raw data** — strokes-gained paper: http://www.columbia.edu/~mnb2/broadie/Assets/strokes_gained_pga_broadie_20110408.pdf (uses PGA TOUR ShotLink; no public dataset). PGA TOUR ShotLink academic access: https://www.pgatour.com/stats/academicdata/shotlink.html — not-for-profit academic license only (exact terms UNVERIFIED, page behind cookie wall). **Not available for a commercial app; pro on-course data in any case.**
- **Academic open datasets** — e.g. "CaddieSet" (arXiv 2508.20491, https://arxiv.org/html/2508.20491v1 : 924 shots with per-shot launch-monitor outputs incl. Carry) — tiny lab sample, population not representative, dataset license UNVERIFIED; "GolfDB" contains swing videos without ball data; a Zenodo record (10.5281/zenodo.7256387) referenced for launch-monitor data is an empty record with no license. **Not suitable.**
- **Legacy TrackMan amateur blog** — "performance of the average male amateur" (average amateur male 214 yards) cited inside the USGA Distance Insights 2020 report — https://blog.trackmangolf.com/performance-of-the-average-male-amateur/ — a blog post, not a dataset; methodology/sample UNVERIFIED. **Link-only at most.**

---

## Measurement compatibility with Inrange

Inrange exports (per Inrange FAQ, https://www.inrangegolf.com/players/faqs, and `app/src/domain/csv.ts`): range-ball carry/total (true limited-flight trajectory), **premium-ball estimated** carry/total (trajectory converted to premium-ball behaviour; flat variants correct for bay elevation), ball speed, launch.

| Inrange quantity | Honest external comparison | Notes |
|---|---|---|
| Range-ball carry | **None.** Limited-flight range balls fly shorter; no external source measures range balls. Never compare to external carry. |
| Premium-ball estimated carry | Carry figures from launch-monitor sources: TrackMan Tour Averages (pro, carry), USGA R22 range-testing carry (amateur, small samples). **Not** Arccos/Shot Scope/pgatour.com/lpga.com (those are on-course, sensor/GPS/ShotLink distances). |
| Flat carry | Same as premium carry, plus elevation correction — no external source applies the same correction; compare only approximately. |
| Total distance | On-course total figures: Arccos driver total (carry+rollout, by handicap/age/gender), PGA TOUR/LPGA driving distance, Shot Scope club distances (carry-vs-total UNVERIFIED). Range total (carry + modelled roll on the range) is **not** the same as on-course total (different surface, wind, elevation) — label carefully. |
| Ball speed, launch, spin | Only TrackMan Tour Averages (pro) and USGA R22-01 launch-condition study (amateur, by skill level). Pro numbers must not be used as amateur targets (roadmap §7.4). |

Rules that follow from the above:
1. Never compare an external **on-course total** with Inrange **carry**.
2. Only compare **carry to carry** and **total to total**, and state the venue (range vs course) and population (amateur vs tour) in the overlay.
3. Arccos/Shot Scope amateur figures are the only large-sample amateur references, and they are on-course totals — suitable for driver "total distance" context only, with a visible caveat.
4. Percentile/filtered statistics (Shot Scope P-AVG, Arccos random-sample averages, USGA means±SD, TrackMan means) are different estimators — do not mix them in one chart without labels.

## Compliant alternatives if licensing stays unclear

1. **Link-out overlays (recommended default).** In club profiles, render a clearly-marked "Compare with external reference" row that links to the primary source (e.g. Arccos 2026 Driving Distance Report, TrackMan Tour Averages, PGA TOUR stats) with an attribution string and the metric/venue caveat. All reviewed sources permit linking and plain-text attribution; MyGolfSpy additionally permits brief quotations with a link back.
2. **User-entered reference values.** Let the user type their own reference carry/total per club (e.g. from their home club's chart or a fitting session). Stored as user data, labelled "user-entered reference", never mixed with imported measurements.
3. **Quote-with-attribution of a few numbers** where terms allow brief excerpts (MyGolfSpy terms; fair-use-style quotation elsewhere is a legal judgement — keep to a handful of figures with citation, not a republished table). **UNVERIFIED** as a general rule for the other sources; do not rely on it.
4. **Written permission / partnership.** Arccos (On-Course Data API partner program) and Shot Scope (licensing contact via terms page) both have formal licensing channels — a written license could make embedding lawful. PGA TOUR expressly licenses data commercially (§7(A) "unless expressly licensed"). Budget lead time; do not embed before a signed license exists.
5. **USGA/R&A PDFs** are publicly downloadable; embedding their tables still lacks an explicit license — request permission or link out. Their range-based methodology makes them the best future embed candidate.

## Suggested next step for the implementation PR (PR 16/17)

- **Start with: link-only benchmark references + user-entered reference values. No embedded third-party dataset.** First link-out targets: Arccos Annual Driving Distance Report (2026 edition URL above) for driver total-distance context by handicap, and TrackMan Tour Averages / pgatour.com stat 101 as clearly-labelled "PGA TOUR / LPGA (professional, on-course)" reference links.
- **Data shape** (new versioned module, e.g. `app/src/domain/benchmarks.ts` + JSON fixtures, kept out of user data):
  ```ts
  type BenchmarkSource = {
    id: string;                    // e.g. "arccos-ddr-2026"
    name: string;                  // "Arccos Annual Driving Distance Report, 2026 edition"
    publisher: string;             // "Arccos Golf"
    url: string;                   // primary URL
    publicationDate: string;       // ISO
    license: "link-only" | "embedded-with-license";
    metric: "carry" | "total";
    venue: "range" | "course" | "mixed";
    population: string;            // "Arccos members (amateur), 160+ countries"
    clubs: string[];               // ["driver"] etc.
    sampleSize?: string;           // human-readable, e.g. "~10M driver tee shots, >5M rounds (2025)"
    retrievedAt: string;           // ISO date we verified the URL
  };
  type BenchmarkReference = { sourceId: string; club: string; label: string; url: string }; // what the UI links out to
  type UserReferenceValue = { clubId: string; metric: "carry"|"total"; valueM: number; note?: string }; // user-entered, labelled as such
  ```
- **Attribution string** shown next to any benchmark link, e.g.: `Reference: Arccos Annual Driving Distance Report 2026 (arccosgolf.com) — amateur on-course driver TOTAL distance (carry+rollout), not range carry. Linked source; data not embedded (licensing).`
- **UI rule:** benchmark overlays are optional per club profile; every overlay carries source name, URL, metric (carry/total), venue (range/course), population, and publication date; pro sources carry a "professional reference — not an amateur target" badge; range-ball measurements never get a benchmark overlay.
- **Tests:** fixture-driven tests that (a) every benchmark entry has license != "embedded-with-license" unless a license file/reference exists, (b) metric/venue labels render, (c) user-entered references stay separate from imported measurements.

---

*Research conducted 2026-11-25 via primary sources only; pages that block automated access (usga.org PDFs/pages, arccosgolf.com www terms, lpga.com stats) are noted, and figures taken from search-indexed text of those pages are marked UNVERIFIED where not directly confirmed.*
