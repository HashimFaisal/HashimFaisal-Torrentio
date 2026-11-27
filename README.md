# Torrentio

- [torrentio-addon](addon) - the Stremio addon which will query scraped entries and return Stremio stream results.

 
## Nuvio plugin

The `nuvio-plugin/` directory contains the Torrentio Local Nuvio scraper. It validates torrent identifiers, magnets, swarm metadata, file sizes, and optional provider quality scores before ranking results. Invalid optional quality scores are normalized to zero and surfaced as diagnostics rather than causing a valid stream to be discarded.


### Release 0.4.5 — merged diagnostics

When duplicate rows share the same BTIH, Torrentio Local now preserves quality-score warning codes from every merged provider/index row. A valid duplicate can contribute a usable score without hiding the fact that another row supplied malformed optional metadata.
