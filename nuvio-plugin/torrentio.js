/* Torrentio Local for Nuvio. Metadata only; Nuvio handles P2P playback. */
var TMDB_BASE = "https://api.themoviedb.org/3";
var INDEX_BASE = "https://therarbg.com/api/v1";
var MAX_RESULTS = 20;

function str(v) { return v === null || v === undefined ? "" : String(v); }
function sizeLabel(bytes) {
  var n = Number(bytes || 0), units = ["B", "MB", "GB", "TB"], i = 0;
  if (!isFinite(n) || n <= 0) return "";
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (n >= 100 ? Math.round(n) : n.toFixed(1)) + " " + units[i];
}
function validHash(v) { return /^[a-f0-9]{40}$/i.test(str(v)); }
function isPack(name) {
  return /S\d{1,2}E\d{1,3}\s*[-–]\s*\d{1,3}/i.test(str(name)) ||
    /\b(?:complete|season pack|batch)\b/i.test(str(name));
}
function exactEpisode(item, season, episode) {
  if (isPack(item.name)) return false;
  if (Number(item.season) === Number(season) && Number(item.episode) === Number(episode)) return true;
  var re = new RegExp("(?:^|[^A-Z0-9])S0?" + Number(season) + "E0?" + Number(episode) + "(?![0-9])", "i");
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
async function queryIndex(imdbId, kind, season, episode) {
  var params = "imdb=" + encodeURIComponent(imdbId) +
    "&category=" + (kind === "movie" ? "movies" : "tv") +
    "&limit=50&clean=1&sort=quality";
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
    var item = items[i] || {}, hash = str(item.infoHash).toLowerCase();
    var magnet = str(item.magnet), seeds = Number(item.seeders || 0);
    if (!validHash(hash) || magnet.indexOf("magnet:?xt=urn:btih:") !== 0 || seen[hash] || seeds < 1) continue;
    if (kind !== "movie" && !exactEpisode(item, season, episode)) continue;
    seen[hash] = true;
    var quality = str(item.resolution) || "Torrent";
    out.push({
      title: str(item.name) || "Torrent release",
      name: "The RarBg · " + quality + " · " + seeds + " seeds",
      url: magnet,
      quality: quality,
      size: sizeLabel(item.size),
      provider: "The RarBg",
      type: "torrent",
      seeders: seeds,
      peers: Number(item.leechers || 0),
      infoHash: hash
    });
  }
  return out.slice(0, MAX_RESULTS); // Preserve the index's quality ranking.
}
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    var kind = str(mediaType).toLowerCase();
    if (kind !== "movie" && kind !== "tv" && kind !== "series") return [];
    if (kind !== "movie" &&
        (isNaN(Number(season)) || isNaN(Number(episode)) ||
         Number(season) < 0 || Number(episode) < 1)) return [];
    var imdbId = await imdbFor(tmdbId, kind === "movie" ? "movie" : "tv");
    var rows = await queryIndex(imdbId, kind, season, episode);
    return toStreams(rows, kind, season, episode);
  } catch (err) {
    console.error("[Torrentio Local] " + (err && err.message ? err.message : err));
    return [];
  }
}
module.exports = { getStreams: getStreams };
