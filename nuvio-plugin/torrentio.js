/* Torrentio Local for Nuvio. Returns torrent metadata; Nuvio handles P2P playback. */
var TMDB_BASE = "https://api.themoviedb.org/3";
var INDEX_BASE = "https://therarbg.com/api/v1";
var MAX_RESULTS = 20;

function str(v) { return v === null || v === undefined ? "" : String(v); }
function validHash(v) { return /^[a-f0-9]{40}$/i.test(str(v)); }
function isPack(name) {
  return /S\d{1,2}E\d{1,3}\s*[-–]\s*\d{1,3}/i.test(str(name)) ||
    /\b(?:complete|season pack|batch)\b/i.test(str(name));
}
function exactEpisode(item, season, episode) {
  if (isPack(item.name)) return false;
  if (Number(item.season) === Number(season) &&
      Number(item.episode) === Number(episode)) return true;
  var re = new RegExp("(?:^|[^A-Z0-9])S0?" + Number(season) +
    "E0?" + Number(episode) + "(?![0-9])", "i");
  return re.test(str(item.name));
}
async function imdbFor(tmdbId, mediaType) {
  var key = typeof TMDB_API_KEY !== "undefined" ? TMDB_API_KEY : "";
  if (!key) throw new Error("Nuvio TMDB key unavailable");
  var kind = mediaType === "movie" ? "movie" : "tv";
  var id = str(tmdbId).replace(/^tmdb[:/]/i, "");
  if (!/^\d+$/.test(id)) throw new Error("Invalid TMDB id");
  var url = TMDB_BASE + "/" + kind + "/" + encodeURIComponent(id) +
    "/external_ids?api_key=" + encodeURIComponent(key);
  var res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("TMDB HTTP " + res.status);
  var body = await res.json();
  if (!body || !/^tt\d+$/.test(str(body.imdb_id))) throw new Error("IMDb id not found");
  return body.imdb_id;
}
async function queryIndex(imdbId, kind, season, episode, minSeeders) {
  var params = "imdb=" + encodeURIComponent(imdbId) +
    "&category=" + (kind === "movie" ? "movies" : "tv") +
    "&limit=50&clean=1&min_seeders=" + encodeURIComponent(minSeeders) + "&sort=seeders";
  if (kind !== "movie") params += "&season=" + encodeURIComponent(season) +
    "&episode=" + encodeURIComponent(episode);
  var res = await fetch(INDEX_BASE + "/search/?" + params, {
    headers: { Accept: "application/json" }
  });
  if (!res.ok) throw new Error("The RarBg HTTP " + res.status);
  var data = await res.json();
  if (!data || !Array.isArray(data.results)) throw new Error("Invalid index response");
  return data.results;
}
function toStreams(items, kind, season, episode) {
  var seen = {}, out = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    var hash = str(item.infoHash).toLowerCase();
    var magnet = str(item.magnet);
    var seeds = Number(item.seeders || 0);
    var bytes = Number(item.size || 0);
    if (!validHash(hash) || magnet.indexOf("magnet:?xt=urn:btih:") !== 0 ||
        seen[hash] || seeds < 1 || !isFinite(bytes) || bytes <= 0) continue;
    if (item.verifile === "failed") continue;
    if (kind !== "movie" && !exactEpisode(item, season, episode)) continue;
    // Discard clearly corrupt index sizes, rather than presenting multi-terabyte movie files.
    if (kind === "movie" && bytes > 200 * 1024 * 1024 * 1024) continue;
    if (kind !== "movie" && bytes > 1024 * 1024 * 1024 * 1024) continue;
    seen[hash] = true;
    var quality = str(item.resolution) || "Torrent";
    var detail = [str(item.source), str(item.codec), str(item.hdr)].filter(Boolean).join(" · ");
    var score = Number(item.qualityScore || 0);
    out.push({
      title: str(item.name) || "Torrent release",
      name: "The RarBg · " + quality + " · " + seeds + " seeds" +
        (score ? " · Q" + score : ""),
      url: magnet,
      quality: quality,
      size: bytes,
      provider: "The RarBg",
      type: "torrent",
      seeders: seeds,
      peers: Number(item.leechers || 0),
      infoHash: hash,
      source: str(item.source),
      codec: str(item.codec),
      hdr: str(item.hdr),
      qualityScore: score,
      verifile: str(item.verifile),
      description: detail
    });
  }
  // Prefer the healthiest swarm first; quality is the tie-breaker.
  out.sort(function(a,b) {
    if (b.seeders !== a.seeders) return b.seeders - a.seeders;
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return b.peers - a.peers;
  });
  return out.slice(0, MAX_RESULTS);
}
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    var kind = str(mediaType).toLowerCase();
    if (kind !== "movie" && kind !== "tv" && kind !== "series") return [];
    if (kind !== "movie" &&
        (isNaN(Number(season)) || isNaN(Number(episode)) ||
         Number(season) < 0 || Number(episode) < 1)) return [];
    var imdbId = await imdbFor(tmdbId, kind === "movie" ? "movie" : "tv");
    // Adaptive swarm search: relax the seed threshold only when the stronger
    // threshold does not produce enough usable results. This costs at most
    // three index requests and avoids hiding viable torrents behind stale counts.
    var thresholds = [10, 5, 1];
    var collected = [], seen = {};
    for (var i = 0; i < thresholds.length; i++) {
      var rows = await queryIndex(imdbId, kind, season, episode, thresholds[i]);
      var batch = toStreams(rows, kind, season, episode);
      for (var j = 0; j < batch.length; j++) {
        if (!seen[batch[j].infoHash]) {
          seen[batch[j].infoHash] = true;
          collected.push(batch[j]);
        }
      }
      if (collected.length >= 5) break;
    }
    collected.sort(function(a,b) {
      if (b.seeders !== a.seeders) return b.seeders - a.seeders;
      if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
      return b.peers - a.peers;
    });
    return collected.slice(0, MAX_RESULTS);
  } catch (err) {
    console.error("[Torrentio Local] " + (err && err.message ? err.message : err));
    return [];
  }
}
module.exports = { getStreams: getStreams };
