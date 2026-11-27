/* Torrentio Local for Nuvio. Returns torrent metadata; Nuvio handles P2P playback. */
var TMDB_BASE = "https://api.themoviedb.org/3";
var INDEX_BASE = "https://therarbg.com/api/v1";
var MAX_RESULTS = 20;

// Small in-memory TTL cache with in-flight request coalescing.
// TMDB IDs are stable for hours; swarm counts are deliberately cached briefly.
var responseCache = Object.create(null);
var CACHE_LIMIT = 128;
function cached(key, ttlMs, loader) {
  var now = Date.now();
  var entry = responseCache[key];
  if (entry && entry.expiresAt > now && Object.prototype.hasOwnProperty.call(entry, "value")) {
    return Promise.resolve(entry.value);
  }
  if (entry && entry.pending) return entry.pending;
  var pending = Promise.resolve().then(loader).then(function(value) {
    responseCache[key] = { value: value, expiresAt: Date.now() + ttlMs };
    var keys = Object.keys(responseCache);
    if (keys.length > CACHE_LIMIT) {
      keys.sort(function(a, b) {
        return (responseCache[a].expiresAt || 0) - (responseCache[b].expiresAt || 0);
      });
      for (var i = 0; i < keys.length - CACHE_LIMIT; i++) delete responseCache[keys[i]];
    }
    return value;
  }).catch(function(error) {
    if (responseCache[key] && responseCache[key].pending === pending) delete responseCache[key];
    throw error;
  });
  responseCache[key] = { pending: pending, expiresAt: now + ttlMs };
  return pending;
}
var TMDB_CACHE_MS = 6 * 60 * 60 * 1000;
var INDEX_CACHE_MS = 90 * 1000;

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

// Heuristic ranking for constrained connections: prefer a healthy swarm and
// manageable file sizes over maximum resolution. This ranks options only;
// actual throughput still depends on peers and the user's network.
// Estimate swarm usability from supply, demand, file size and resolution.
// Leechers are demand, not extra capacity: a crowded swarm must not outrank
// an equally-sized healthy swarm merely because many clients are downloading.
function weakNetworkScore(seeds, leechers, bytes, quality) {
  var q = str(quality).toLowerCase();
  var qualityBonus = /2160|4k|uhd/.test(q) ? -10 :
    /1080/.test(q) ? 4 : /720/.test(q) ? 8 :
    /480|sd/.test(q) ? 3 : 0;
  var sizeGiB = bytes / (1024 * 1024 * 1024);
  var ratio = (seeds + 1) / (leechers + 1);
  var ratioScore = Math.max(-12, Math.min(12, Math.log(ratio) / Math.LN2 * 5));
  return Math.log(seeds + 1) * 10 +
    ratioScore -
    Math.log(leechers + 1) * 3 +
    qualityBonus -
    Math.log(sizeGiB + 1) * 6;
}
function swarmHealth(seeds, leechers) {
  if (seeds >= 8 && seeds >= leechers) return "healthy";
  if (seeds >= 3 && seeds * 2 >= leechers) return "contended";
  return "thin";
}
async function imdbFor(tmdbId, mediaType) {
  var key = typeof TMDB_API_KEY !== "undefined" ? TMDB_API_KEY : "";
  if (!key) throw new Error("Nuvio TMDB key unavailable");
  var kind = mediaType === "movie" ? "movie" : "tv";
  var id = str(tmdbId).replace(/^tmdb[:/]/i, "");
  if (!/^\d+$/.test(id)) throw new Error("Invalid TMDB id");
  return cached("tmdb:" + kind + ":" + id, TMDB_CACHE_MS, async function() {
    var url = TMDB_BASE + "/" + kind + "/" + encodeURIComponent(id) +
      "/external_ids?api_key=" + encodeURIComponent(key);
    var res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("TMDB HTTP " + res.status);
    var body = await res.json();
    if (!body || !/^tt\d+$/.test(str(body.imdb_id))) throw new Error("IMDb id not found");
    return body.imdb_id;
  });
}
async function queryIndex(imdbId, kind, season, episode, minSeeders) {
  var params = "imdb=" + encodeURIComponent(imdbId) +
    "&category=" + (kind === "movie" ? "movies" : "tv") +
    "&limit=50&clean=1&min_seeders=" + encodeURIComponent(minSeeders) + "&sort=seeders";
  if (kind !== "movie") params += "&season=" + encodeURIComponent(season) +
    "&episode=" + encodeURIComponent(episode);
  var cacheKey = "index:" + kind + ":" + imdbId + ":" +
    (kind === "movie" ? "movie" : String(season) + ":" + String(episode)) +
    ":seeders:" + String(minSeeders);
  return cached(cacheKey, INDEX_CACHE_MS, async function() {
    var res = await fetch(INDEX_BASE + "/search/?" + params, {
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error("The RarBg HTTP " + res.status);
    var data = await res.json();
    if (!data || !Array.isArray(data.results)) throw new Error("Invalid index response");
    return data.results;
  });
}
function toStreams(items, kind, season, episode) {
  var seen = {}, out = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    var hash = str(item.infoHash).toLowerCase();
    var magnet = str(item.magnet);
    var magnetMatch = magnet.match(/(?:^|[?&])xt=urn:btih:([a-f0-9]{40})(?:&|$)/i);
    var seeds = Number(item.seeders || 0);
    var leechers = Number(item.leechers || 0);
    var bytes = Number(item.size || 0);
    if (!validHash(hash) || !magnetMatch ||
        magnetMatch[1].toLowerCase() !== hash ||
        seen[hash] || !isFinite(seeds) || seeds < 1 ||
        !isFinite(leechers) || leechers < 0 ||
        !isFinite(bytes) || bytes <= 0) continue;
    if (str(item.verifile).toLowerCase() === "failed") continue;
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
      networkScore: weakNetworkScore(seeds, leechers, bytes, quality),
      swarmHealth: swarmHealth(seeds, leechers),
      verifile: str(item.verifile),
      description: detail
    });
  }
  // Prefer swarms that are more practical on constrained connections.
  out.sort(function(a,b) {
    if (b.networkScore !== a.networkScore) return b.networkScore - a.networkScore;
    if (b.seeders !== a.seeders) return b.seeders - a.seeders;
    return b.qualityScore - a.qualityScore;
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
      if (b.networkScore !== a.networkScore) return b.networkScore - a.networkScore;
      if (b.seeders !== a.seeders) return b.seeders - a.seeders;
      return b.qualityScore - a.qualityScore;
    });
    return collected.slice(0, MAX_RESULTS);
  } catch (err) {
    console.error("[Torrentio Local] " + (err && err.message ? err.message : err));
    return [];
  }
}
module.exports = { getStreams: getStreams };
