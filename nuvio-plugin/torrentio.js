/* Torrentio Local for Nuvio. Returns torrent metadata; Nuvio handles P2P playback. */
var TMDB_BASE = "https://api.themoviedb.org/3";
var INDEX_BASE = "https://therarbg.com/api/v1";
var YTS_BASE = "https://movies-api.accel.li/api/v2";
var EZTV_BASE = "https://eztvx.to/api";
var MAX_RESULTS = 30;

// Small in-memory TTL cache with in-flight request coalescing.
// TMDB IDs are stable for hours; swarm counts are deliberately cached briefly.
var responseCache = Object.create(null);
var CACHE_LIMIT = 128;
function cached(key, ttlMs, loader, staleMs) {
  var now = Date.now();
  var entry = responseCache[key];
  if (entry && Object.prototype.hasOwnProperty.call(entry, "value")) {
    if (entry.expiresAt > now) return Promise.resolve(entry.value);
    // Brief stale-while-revalidate avoids making Nuvio wait on an upstream
    // catalog when a recently good result is already available.
    if (entry.staleUntil > now) {
      if (!entry.pending && (!entry.retryAfter || entry.retryAfter <= now)) {
        refreshCacheEntry(key, ttlMs, staleMs, loader, entry).catch(function() {});
      }
      return Promise.resolve(entry.value);
    }
  }
  if (entry && entry.pending) return entry.pending;
  return refreshCacheEntry(key, ttlMs, staleMs, loader, entry);
}
function refreshCacheEntry(key, ttlMs, staleMs, loader, previous) {
  var staleValue = previous && Object.prototype.hasOwnProperty.call(previous, "value")
    ? previous.value : undefined;
  var hadStaleValue = previous && Object.prototype.hasOwnProperty.call(previous, "value");
  var pending = Promise.resolve().then(loader).then(function(value) {
    var now = Date.now();
    responseCache[key] = {
      value: value, expiresAt: now + ttlMs,
      staleUntil: now + ttlMs + Math.max(0, staleMs || 0), pending: null, retryAfter: 0
    };
    var keys = Object.keys(responseCache);
    if (keys.length > CACHE_LIMIT) {
      keys.sort(function(a, b) {
        return (responseCache[a].staleUntil || responseCache[a].expiresAt || 0) -
          (responseCache[b].staleUntil || responseCache[b].expiresAt || 0);
      });
      for (var i = 0; i < keys.length - CACHE_LIMIT; i++) delete responseCache[keys[i]];
    }
    return value;
  }).catch(function(error) {
    if (hadStaleValue) {
      responseCache[key] = {
        value: staleValue, expiresAt: 0,
        staleUntil: previous.staleUntil || Date.now() + Math.max(0, staleMs || 0),
        pending: null, retryAfter: Date.now() + 15000
      };
      return staleValue;
    }
    if (responseCache[key] && responseCache[key].pending === pending) delete responseCache[key];
    throw error;
  });
  responseCache[key] = {
    value: staleValue, expiresAt: previous && previous.expiresAt || 0,
    staleUntil: previous && previous.staleUntil || 0,
    pending: pending, retryAfter: 0
  };
  return pending;
}
var TMDB_CACHE_MS = 6 * 60 * 60 * 1000;
var TMDB_STALE_MS = 24 * 60 * 60 * 1000;
var INDEX_CACHE_MS = 90 * 1000;
var INDEX_STALE_MS = 2 * 60 * 1000;
var PROVIDER_CACHE_MS = 2 * 60 * 1000;
var PROVIDER_STALE_MS = 2 * 60 * 1000;
var PROVIDER_FAILURE_THRESHOLD = 3;
var PROVIDER_COOLDOWN_MS = 60 * 1000;
var PROVIDER_SLOW_THRESHOLD_MS = 9000;
var PROVIDER_SLOW_COOLDOWN_MS = 30 * 1000;
var providerHealth = Object.create(null);
function providerState(name) {
  return providerHealth[name] || (providerHealth[name] = {
    requests: 0, successes: 0, failures: 0, results: 0, lastLatencyMs: 0,
    averageLatencyMs: 0, consecutiveFailures: 0, circuitOpenUntil: 0,
    lastError: "", lastErrorKind: "", lastSuccessAt: 0, lastFailureAt: 0,
    windowStartedAt: Date.now(), windowRequests: 0, windowFailures: 0,
    probeInFlight: false, skippedRequests: 0, emptyResponses: 0,
    lastResultCount: 0, lastStatusCode: 0, lastOutcome: "not-yet-queried"
  });
}
function classifyProviderError(error) {
  var message = str(error && error.message ? error.message : error).toLowerCase();
  var status = Number((message.match(/http\s+(\d{3})/) || [])[1] || 0);
  if (status === 401 || status === 403) return "provider-auth-error";
  if (status === 404 || status === 410) return "provider-endpoint-error";
  if (status === 429) return "provider-rate-limited";
  if (status >= 400 && status < 500) return "provider-http-client-error";
  if (status >= 500) return "provider-http-server-error";
  if (/invalid .*response|malformed|unexpected.*json/.test(message)) return "malformed-index-response";
  if (/timeout|timed out|abort/.test(message)) return "provider-timeout";
  if (/fetch|network|connect|socket|dns/.test(message)) return "provider-network-error";
  return "provider-error";
}
function recordProvider(name, startedAt, ok, detail) {
  var state = providerState(name);
  var latency = Math.max(0, Date.now() - startedAt);
  if (Date.now() - state.windowStartedAt > 10 * 60 * 1000) {
    state.windowStartedAt = Date.now(); state.windowRequests = 0; state.windowFailures = 0;
  }
  state.requests++; state.windowRequests++;
  state.lastLatencyMs = latency;
  state.averageLatencyMs = state.averageLatencyMs ? Math.round(state.averageLatencyMs * 0.7 + latency * 0.3) : latency;
  if (ok) {
    var resultCount = Number(detail) || 0;
    state.successes++; state.results += resultCount; state.lastResultCount = resultCount;
    state.lastOutcome = resultCount ? "success-with-results" : "success-empty";
    if (!resultCount) state.emptyResponses++;
    state.lastError = ""; state.lastErrorKind = ""; state.consecutiveFailures = 0;
    state.lastSuccessAt = Date.now();
    if (latency >= PROVIDER_SLOW_THRESHOLD_MS) {
      state.circuitOpenUntil = Date.now() + PROVIDER_SLOW_COOLDOWN_MS;
      state.lastErrorKind = "provider-slow-response";
      state.lastError = "Catalog lookup took " + latency + "ms; temporary cooldown applied";
      state.lastOutcome = "slow-response";
    } else {
      state.circuitOpenUntil = 0; state.lastErrorKind = ""; state.lastError = "";
    }
  } else {
    state.failures++; state.windowFailures++; state.consecutiveFailures++;
    state.lastError = str(detail && detail.message ? detail.message : detail || "provider failed").slice(0, 180);
    state.lastErrorKind = classifyProviderError(detail);
    var statusMatch = state.lastError.match(/HTTP\s+(\d{3})/i);
    state.lastStatusCode = statusMatch ? Number(statusMatch[1]) : 0;
    state.lastOutcome = state.lastErrorKind;
    state.lastFailureAt = Date.now();
    // A failed half-open probe immediately reopens the circuit.
    // Configuration/endpoint failures are unlikely to heal within a short
    // retry window. Rate limits receive a shorter but explicit backoff.
    if (state.lastErrorKind === "provider-auth-error" || state.lastErrorKind === "provider-endpoint-error") {
      state.circuitOpenUntil = Date.now() + 10 * 60 * 1000;
    } else if (state.lastErrorKind === "provider-rate-limited") {
      state.circuitOpenUntil = Date.now() + 2 * 60 * 1000;
    } else if (state.consecutiveFailures >= PROVIDER_FAILURE_THRESHOLD || state.circuitOpenUntil > 0) {
      state.circuitOpenUntil = Date.now() + PROVIDER_COOLDOWN_MS;
    }
  }
}

function str(v) { return v === null || v === undefined ? "" : String(v); }
function normalizeBtih(value) {
  var hash = str(value).trim();
  if (/^[a-f0-9]{40}$/i.test(hash)) return hash.toLowerCase();
  if (!/^[a-z2-7]{32}$/i.test(hash)) return "";
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  var buffer = 0, bits = 0, hex = "";
  for (var i = 0; i < hash.length; i++) {
    buffer = (buffer << 5) | alphabet.indexOf(hash.charAt(i).toUpperCase());
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      var byte = (buffer >> bits) & 255;
      hex += (byte < 16 ? "0" : "") + byte.toString(16);
      buffer &= (1 << bits) - 1;
    }
  }
  return hex.length === 40 && bits === 0 ? hex : "";
}
function validHash(v) { return normalizeBtih(v) !== ""; }
function isPack(name) {
  var title = str(name);
  // Reject season packs and multi-episode releases: matching the first
  // episode token must not make a batch look like a single episode.
  return /\bS\d{1,2}E\d{1,3}(?:\s*[-–]\s*(?:S\d{1,2})?E?\d{1,3}|E\d{1,3})/i.test(title) ||
    /\b\d{1,2}x\d{1,3}\s*[-–]\s*\d{1,2}x?\d{1,3}/i.test(title) ||
    /\b(?:complete|season pack|batch)\b/i.test(title);
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
var NETWORK_PROFILES = {
  weak: { movieMaxGiB: 4, episodeMaxGiB: 2.5, sizePenalty: 9, q2160: -18, q1080: -2, q720: 12, q480: 5 },
  medium: { movieMaxGiB: 12, episodeMaxGiB: 6, sizePenalty: 5, q2160: -5, q1080: 10, q720: 7, q480: 2 },
  fast: { movieMaxGiB: 30, episodeMaxGiB: 18, sizePenalty: 2, q2160: 13, q1080: 10, q720: 3, q480: -2 }
};
// This is a catalog-response heuristic, not a measurement of P2P throughput.
function getNetworkProfile() {
  var names = Object.keys(providerHealth), latencies = [], requests = 0, failures = 0;
  names.forEach(function(name) {
    var state = providerHealth[name];
    if (state.requests) {
      latencies.push(state.averageLatencyMs || state.lastLatencyMs);
      requests += state.windowRequests || 0; failures += state.windowFailures || 0;
    }
  });
  if (!latencies.length) return "medium";
  var avg = latencies.reduce(function(a,b) { return a + b; }, 0) / latencies.length;
  var failureRate = requests ? failures / requests : 0;
  if (avg >= 1600 || failureRate >= 0.35) return "weak";
  if (avg <= 500 && failureRate < 0.1) return "fast";
  return "medium";
}
function weakNetworkScore(seeds, leechers, bytes, quality, profile) {
  var q = str(quality).toLowerCase();
  var rules = NETWORK_PROFILES[profile] || NETWORK_PROFILES.medium;
  var qualityBonus = /2160|4k|uhd/.test(q) ? rules.q2160 :
    /1080/.test(q) ? rules.q1080 : /720/.test(q) ? rules.q720 :
    /480|sd/.test(q) ? rules.q480 : 0;
  var sizeGiB = bytes / (1024 * 1024 * 1024);
  var ratio = (seeds + 1) / (leechers + 1);
  var ratioScore = Math.max(-12, Math.min(12, Math.log(ratio) / Math.LN2 * 5));
  return Math.log(seeds + 1) * 10 + ratioScore - Math.log(leechers + 1) * 3 +
    qualityBonus - Math.log(sizeGiB + 1) * rules.sizePenalty;
}
function recordDiagnostic(diagnostics, reason) {
  if (!diagnostics) return;
  diagnostics[reason] = (diagnostics[reason] || 0) + 1;
}
function normalizedQualityScore(value) {
  if (value === null || value === undefined || value === "") return { score: 0, valid: true };
  var score = Number(value);
  if (!isFinite(score) || Math.floor(score) !== score || score < 0 || score > 1000) {
    return { score: 0, valid: false };
  }
  return { score: score, valid: true };
}
function swarmHealth(seeds, leechers) {
  if (seeds >= 8 && seeds >= leechers) return "healthy";
  if (seeds >= 3 && seeds * 2 >= leechers) return "contended";
  return "thin";
}

// Normalize resolution from both structured API metadata and release title.
// When they disagree, use the lower resolution so we never advertise an
// uncertain release as higher quality than its own title supports.
function resolutionRank(value) {
  var q = str(value).toLowerCase();
  if (/2160|4k|uhd/.test(q)) return 5;
  if (/1440|2k/.test(q)) return 4;
  if (/1080/.test(q)) return 3;
  if (/720/.test(q)) return 2;
  if (/480|sd/.test(q)) return 1;
  return 0;
}
function resolutionLabel(rank) {
  return rank >= 5 ? "2160p" : rank === 4 ? "1440p" :
    rank === 3 ? "1080p" : rank === 2 ? "720p" :
    rank === 1 ? "480p" : "Unknown";
}
function releaseMetadata(item) {
  var title = str(item.name);
  var structured = resolutionRank(item.resolution);
  var fromTitle = resolutionRank(title);
  var conflict = structured > 0 && fromTitle > 0 && structured !== fromTitle;
  var rank = structured && fromTitle ? Math.min(structured, fromTitle) : (structured || fromTitle);
  // Infer presentation tags from release names without overstating confidence.
  var inferredSource = /blu.?ray|bdrip|brrip/i.test(title) ? "BluRay" :
    /web.?dl/i.test(title) ? "WEB-DL" : /web.?rip/i.test(title) ? "WEBRip" :
    /hdtv/i.test(title) ? "HDTV" : "";
  var inferredCodec = /\bav1\b/i.test(title) ? "AV1" :
    /x265|h\.?265|hevc/i.test(title) ? "HEVC" :
    /x264|h\.?264|avc/i.test(title) ? "H.264" : "";
  var inferredHdr = /dolby.?vision|\bdovi\b/i.test(title) ? "Dolby Vision" :
    /hdr10\+/i.test(title) ? "HDR10+" : /\bhdr\b/i.test(title) ? "HDR" : "";
  var inferredAudio = /truehd/i.test(title) ? "TrueHD" :
    /dts.?hd|dts.?x/i.test(title) ? "DTS-HD" :
    /\batmos\b/i.test(title) ? "Atmos" : /\beac3\b|\bddp\b/i.test(title) ? "E-AC3" : "";
  var source = str(item.source) || inferredSource;
  var codec = str(item.codec) || inferredCodec;
  var hdr = str(item.hdr) || inferredHdr;
  var warnings = [];
  if (conflict) warnings.push("resolution-conflict");
  if (!str(item.source)) warnings.push(inferredSource ? "source-inferred-from-title" : "missing-source");
  if (!str(item.codec)) warnings.push(inferredCodec ? "codec-inferred-from-title" : "missing-codec");
  if (!str(item.hdr) && inferredHdr) warnings.push("hdr-inferred-from-title");
  if (!str(item.audio) && inferredAudio) warnings.push("audio-inferred-from-title");
  var verification = str(item.verifile).toLowerCase().trim();
  if (verification && verification !== "verified") warnings.push("verification-unconfirmed");
  var confidence = 100;
  if (verification && verification !== "verified") confidence -= 12;
  if (conflict) confidence -= 35;
  if (!str(item.source)) confidence -= 10;
  if (!str(item.codec)) confidence -= 10;
  if (!title || title.length < 8) confidence -= 20;
  if (!rank) confidence -= 10;
  return {
    quality: resolutionLabel(rank), source: source, codec: codec, hdr: hdr,
    audio: str(item.audio) || inferredAudio,
    confidence: Math.max(0, confidence), warnings: warnings, conflict: conflict
  };
}
function validCount(value) {
  var n = Number(value);
  return isFinite(n) && n >= 0 && Math.floor(n) === n && n <= Number.MAX_SAFE_INTEGER;
}
function rejectedVerification(value) {
  if (value === false || value === 0) return true;
  var state = str(value).toLowerCase().trim();
  // The upstream API distinguishes failed from cant_check/retried/unknown.
  // Only an explicit failed verdict means the content was checked and rejected.
  return state === "failed";
}
// Idempotent GET recovery for temporary upstream/network failures.
// Bounded retries prevent request storms and permanent 4xx responses fail fast.
var REQUEST_MAX_ATTEMPTS = 3;
function waitMs(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}
function retryDelay(response, attempt) {
  var retryAfter = 0;
  try {
    var raw = response && response.headers && response.headers.get("Retry-After");
    if (raw && /^\d+(?:\.\d+)?$/.test(raw)) retryAfter = Number(raw) * 1000;
  } catch (_) {}
  return Math.min(2000, Math.max(250 * Math.pow(2, attempt), retryAfter));
}
var REQUEST_TIMEOUT_MS = 8000;
async function fetchWithTimeout(url, service) {
  var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timer;
  var options = { headers: { Accept: "application/json" } };
  if (controller) options.signal = controller.signal;
  var pending = fetch(url, options);
  var timeout = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      if (controller) { try { controller.abort(); } catch (_) {} }
      reject(new Error(service + " request timeout after " + REQUEST_TIMEOUT_MS + "ms"));
    }, REQUEST_TIMEOUT_MS);
  });
  try { return await Promise.race([pending, timeout]); }
  finally { clearTimeout(timer); }
}
async function requestJson(url, service) {
  var lastError;
  for (var attempt = 0; attempt < REQUEST_MAX_ATTEMPTS; attempt++) {
    var response;
    try {
      response = await fetchWithTimeout(url, service);
      if (!response.ok) {
        var statusError = new Error(service + " HTTP " + response.status);
        var retryable = response.status === 408 || response.status === 429 ||
          response.status === 500 || response.status === 502 ||
          response.status === 503 || response.status === 504;
        if (!retryable || attempt === REQUEST_MAX_ATTEMPTS - 1) throw statusError;
        lastError = statusError;
        await waitMs(retryDelay(response, attempt));
        continue;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (/request timeout/i.test(str(error && error.message))) throw error;
      if (response && !response.ok && !(
        response.status === 408 || response.status === 429 ||
        response.status === 500 || response.status === 502 ||
        response.status === 503 || response.status === 504
      )) throw error;
      if (attempt === REQUEST_MAX_ATTEMPTS - 1) throw error;
      await waitMs(250 * Math.pow(2, attempt));
    }
  }
  throw lastError || new Error(service + " request failed");
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
    var body = await requestJson(url, "TMDB");
    if (!body || !/^tt\d+$/.test(str(body.imdb_id))) throw new Error("IMDb id not found");
    return body.imdb_id;
  }, TMDB_STALE_MS);
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
    var data = await requestJson(INDEX_BASE + "/search/?" + params, "The RarBg");
    if (!data || !Array.isArray(data.results)) throw new Error("Invalid index response");
    return data.results;
  }, INDEX_STALE_MS);
}
function mergeSameHash(existing, incoming) {
  // Same infoHash means the same torrent payload. Merge duplicate index rows
  // instead of letting whichever threshold ran first win by accident.
  var preferred = incoming.metadataConfidence > existing.metadataConfidence ? incoming : existing;
  var swarm = incoming.networkScore > existing.networkScore ? incoming : existing;
  var merged = Object.assign({}, preferred);
  merged.seeders = Math.max(existing.seeders, incoming.seeders);
  merged.peers = Math.max(existing.peers, incoming.peers);
  merged.networkScore = Math.max(existing.networkScore, incoming.networkScore);
  merged.qualityScore = Math.max(existing.qualityScore || 0, incoming.qualityScore || 0);
  merged.swarmHealth = swarm.swarmHealth;
  var providers = Array.from(new Set((existing.providers || [existing.provider || "The RarBg"]).concat(incoming.providers || [incoming.provider || "The RarBg"])));
  merged.providers = providers;
  merged.provider = providers.join(" + ");
  merged.name = merged.provider + " · " + merged.quality + " · " + merged.seeders + " seeds" +
    (merged.qualityScore ? " · Q" + merged.qualityScore : "");
  merged.metadataConfidence = Math.max(existing.metadataConfidence, incoming.metadataConfidence);
  merged.metadataWarnings = (preferred.metadataWarnings || []).slice();
  merged.qualityScoreWarnings = Array.from(new Set(
    (existing.qualityScoreWarnings || []).concat(incoming.qualityScoreWarnings || [])
  ));
  merged.source = preferred.source || existing.source || incoming.source || "";
  merged.codec = preferred.codec || existing.codec || incoming.codec || "";
  merged.hdr = preferred.hdr || existing.hdr || incoming.hdr || "";
  merged.audio = preferred.audio || existing.audio || incoming.audio || "";
  merged.description = [merged.source, merged.codec, merged.hdr, merged.audio].filter(Boolean).join(" · ");
  merged.duplicateCount = (existing.duplicateCount || 1) + (incoming.duplicateCount || 1);
  var titles = (existing.alternateTitles || [existing.title])
    .concat(incoming.alternateTitles || [incoming.title]).filter(Boolean);
  merged.alternateTitles = Array.from(new Set(titles)).slice(0, 5);
  if (existing.size !== incoming.size) {
    merged.metadataWarnings.push("duplicate-size-conflict");
    merged.metadataConfidence = Math.max(0, merged.metadataConfidence - 15);
  }
  if (existing.quality !== incoming.quality) {
    merged.metadataWarnings.push("duplicate-quality-conflict");
  }
  return merged;
}

function toStreams(items, kind, season, episode, diagnostics, profile) {
  var seen = Object.create(null), out = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    var hash = normalizeBtih(item.infoHash);
    var magnet = str(item.magnet);
    var magnetMatch = magnet.match(/(?:^|[?&])xt=urn:btih:([a-z2-7]{32}|[a-f0-9]{40})(?:&|$)/i);
    var magnetHash = magnetMatch ? normalizeBtih(magnetMatch[1]) : "";
    var seeds = Number(item.seeders);
    var leechers = item.leechers === undefined || item.leechers === null || item.leechers === "" ? 0 : Number(item.leechers);
    var bytes = Number(item.size);
    if (!validHash(hash)) { recordDiagnostic(diagnostics, "invalid-infohash"); continue; }
    if (!magnetMatch) { recordDiagnostic(diagnostics, "invalid-or-missing-magnet"); continue; }
    if (magnetHash !== hash) { recordDiagnostic(diagnostics, "magnet-infohash-mismatch"); continue; }
    if (!validCount(seeds) || seeds < 1 || !validCount(leechers)) { recordDiagnostic(diagnostics, "missing-or-invalid-swarm-data"); continue; }
    if (!isFinite(bytes) || bytes <= 0 || Math.floor(bytes) !== bytes || bytes > Number.MAX_SAFE_INTEGER) { recordDiagnostic(diagnostics, "missing-or-invalid-file-size"); continue; }
    if (rejectedVerification(item.verifile)) { recordDiagnostic(diagnostics, "verification-failed"); continue; }
    if (kind !== "movie" && !exactEpisode(item, season, episode)) { recordDiagnostic(diagnostics, "wrong-episode-or-pack"); continue; }
    // Discard clearly corrupt index sizes, rather than presenting multi-terabyte movie files.
    if (kind === "movie" && bytes > 200 * 1024 * 1024 * 1024) { recordDiagnostic(diagnostics, "implausible-movie-size"); continue; }
    if (kind !== "movie" && bytes > 1024 * 1024 * 1024 * 1024) { recordDiagnostic(diagnostics, "implausible-episode-size"); continue; }
    var metadata = releaseMetadata(item);
    var quality = metadata.quality;
    var selectedProfile = profile || getNetworkProfile();
    var profileRules = NETWORK_PROFILES[selectedProfile] || NETWORK_PROFILES.medium;
    var maxGiB = kind === "movie" ? profileRules.movieMaxGiB : profileRules.episodeMaxGiB;
    var networkFit = bytes <= maxGiB * 1024 * 1024 * 1024 ? "recommended-size" : "large-for-profile";
    var detail = [metadata.source, metadata.codec, metadata.hdr, metadata.audio].filter(Boolean).join(" · ");
    var qualityScoreResult = normalizedQualityScore(item.qualityScore);
    var score = qualityScoreResult.score;
    if (!qualityScoreResult.valid) recordDiagnostic(diagnostics, "invalid-quality-score");
    var candidate = {
      title: str(item.name) || "Torrent release",
      name: (str(item.provider) || "The RarBg") + " · " + quality + " · " + seeds + " seeds" +
        (score ? " · Q" + score : ""),
      url: magnet,
      quality: quality,
      size: bytes,
      provider: str(item.provider) || "The RarBg",
      providers: [str(item.provider) || "The RarBg"],
      type: "torrent",
      seeders: seeds,
      peers: Number(item.leechers || 0),
      infoHash: hash,
      source: metadata.source,
      codec: metadata.codec,
      hdr: metadata.hdr,
      audio: metadata.audio,
      qualityScore: score,
      qualityScoreWarnings: qualityScoreResult.valid ? [] : ["invalid-quality-score"],
      networkScore: weakNetworkScore(seeds, leechers, bytes, quality, selectedProfile),
      networkProfile: selectedProfile,
      networkFit: networkFit,
      swarmHealth: swarmHealth(seeds, leechers),
      metadataConfidence: metadata.confidence,
      metadataWarnings: metadata.warnings,
      verifile: str(item.verifile),
      description: detail,
      duplicateCount: 1,
      alternateTitles: [str(item.name) || "Torrent release"]
    };
    if (seen[hash] !== undefined) {
      out[seen[hash]] = mergeSameHash(out[seen[hash]], candidate);
    } else {
      seen[hash] = out.length;
      out.push(candidate);
    }
  }
  // Prefer swarms that are more practical on constrained connections.
  out.sort(function(a,b) {
    if (b.networkScore !== a.networkScore) return b.networkScore - a.networkScore;
    if (b.metadataConfidence !== a.metadataConfidence) return b.metadataConfidence - a.metadataConfidence;
    if (b.seeders !== a.seeders) return b.seeders - a.seeders;
    return b.qualityScore - a.qualityScore;
  });
  return out.slice(0, MAX_RESULTS);
}
function magnetFor(hash, title) {
  var normalized = normalizeBtih(hash);
  if (!normalized) return "";
  return "magnet:?xt=urn:btih:" + normalized + "&dn=" + encodeURIComponent(str(title)) +
    "&tr=" + encodeURIComponent("udp://tracker.opentrackr.org:1337/announce") +
    "&tr=" + encodeURIComponent("udp://tracker.torrent.eu.org:451/announce");
}
function imdbNumericId(imdbId) { return str(imdbId).replace(/^tt/i, ""); }
async function queryYts(imdbId) {
  return cached("provider:yts:" + imdbId, PROVIDER_CACHE_MS, async function() {
    var url = YTS_BASE + "/list_movies.json?query_term=" + encodeURIComponent(imdbId) +
      "&limit=50&sort_by=seeds&order_by=desc";
    var body = await requestJson(url, "YTS");
    if (!body || body.status !== "ok" || !body.data || !Array.isArray(body.data.movies)) throw new Error("Invalid YTS response");
    var rows = [];
    body.data.movies.forEach(function(movie) {
      if (str(movie.imdb_code).toLowerCase() !== str(imdbId).toLowerCase()) return;
      (Array.isArray(movie.torrents) ? movie.torrents : []).forEach(function(torrent) {
        var hash = normalizeBtih(torrent.hash);
        var title = str(movie.title_long || movie.title) + " " + str(torrent.quality) +
          (torrent.type ? "." + str(torrent.type) : "");
        rows.push({
          name: title, infoHash: hash,
          magnet: str(torrent.magnet_url) || magnetFor(hash, title),
          seeders: torrent.seeds, leechers: torrent.peers, size: torrent.size_bytes,
          resolution: torrent.quality, source: "YTS", codec: torrent.video_codec,
          hdr: /hdr|dolby.?vision/i.test(title) ? "HDR" : "",
          verifile: "unknown", provider: "YTS"
        });
      });
    });
    return rows;
  }, PROVIDER_STALE_MS);
}
async function queryEztv(imdbId) {
  return cached("provider:eztv:" + imdbId, PROVIDER_CACHE_MS, async function() {
    var url = EZTV_BASE + "/get-torrents?limit=100&page=1&imdb_id=" + encodeURIComponent(imdbNumericId(imdbId));
    var body = await requestJson(url, "EZTV");
    if (!body || !Array.isArray(body.torrents)) throw new Error("Invalid EZTV response");
    return body.torrents.map(function(torrent) {
      var title = str(torrent.filename || torrent.title);
      return {
        name: title, infoHash: normalizeBtih(torrent.hash), magnet: str(torrent.magnet_url) || magnetFor(torrent.hash, title),
        seeders: torrent.seeds, leechers: torrent.peers, size: Number(torrent.size_bytes),
        season: torrent.season, episode: torrent.episode, source: "EZTV", codec: "",
        hdr: "", verifile: "unknown", provider: "EZTV"
      };
    });
  }, PROVIDER_STALE_MS);
}
function retryableLookupError(error) {
  var message = str(error && error.message ? error.message : error);
  var match = message.match(/HTTP\s+(\d{3})/i);
  var status = match ? Number(match[1]) : 0;
  return status === 408 || status === 429 || status === 500 ||
    status === 502 || status === 503 || status === 504 ||
    /timeout|timed out|network|fetch failed|socket|dns/i.test(message);
}
async function queryRarbgAdaptive(imdbId, kind, season, episode, diagnostics, profile) {
  // Use the high-quality tier first. A sparse or transiently failed primary
  // lookup unlocks two concurrent fallback tiers; one failed tier must not
  // discard useful results returned by the other.
  var batches = [], primaryError = null;
  try {
    var primary = await queryIndex(imdbId, kind, season, episode, 10);
    batches.push(toStreams(primary, kind, season, episode, diagnostics, profile));
  } catch (error) {
    primaryError = error;
    if (!retryableLookupError(error)) throw error;
    recordDiagnostic(diagnostics, "primary-index-temporarily-unavailable");
  }
  if (!batches.length || batches[0].length < 5) {
    var fallbackResults = await Promise.all([
      queryIndex(imdbId, kind, season, episode, 5).then(
        function(rows) { return { ok: true, rows: rows }; },
        function(error) { return { ok: false, error: error }; }),
      queryIndex(imdbId, kind, season, episode, 1).then(
        function(rows) { return { ok: true, rows: rows }; },
        function(error) { return { ok: false, error: error }; })
    ]);
    for (var f = 0; f < fallbackResults.length; f++) {
      if (fallbackResults[f].ok) {
        batches.push(toStreams(fallbackResults[f].rows, kind, season, episode, diagnostics, profile));
      } else {
        recordDiagnostic(diagnostics, "fallback-index-tier-failed");
      }
    }
    if (primaryError && !fallbackResults.some(function(result) { return result.ok; })) {
      throw primaryError;
    }
  }
  var collected = [], seen = Object.create(null);
  for (var i = 0; i < batches.length; i++) {
    var batch = batches[i];
    for (var j = 0; j < batch.length; j++) {
      var hash = batch[j].infoHash;
      if (seen[hash] !== undefined) collected[seen[hash]] = mergeSameHash(collected[seen[hash]], batch[j]);
      else { seen[hash] = collected.length; collected.push(batch[j]); }
    }
  }
  collected.sort(function(a,b) {
    if (b.networkScore !== a.networkScore) return b.networkScore - a.networkScore;
    if (b.metadataConfidence !== a.metadataConfidence) return b.metadataConfidence - a.metadataConfidence;
    if (b.seeders !== a.seeders) return b.seeders - a.seeders;
    return b.qualityScore - a.qualityScore;
  });
  return collected.slice(0, MAX_RESULTS);
}
function mergeProviderResults(groups) {
  var merged = [], indexes = Object.create(null);
  groups.forEach(function(group) {
    (group || []).forEach(function(stream) {
      var hash = stream.infoHash;
      if (!hash) return;
      if (indexes[hash] !== undefined) merged[indexes[hash]] = mergeSameHash(merged[indexes[hash]], stream);
      else { indexes[hash] = merged.length; merged.push(stream); }
    });
  });
  merged.sort(function(a,b) {
    if (b.networkScore !== a.networkScore) return b.networkScore - a.networkScore;
    if (b.metadataConfidence !== a.metadataConfidence) return b.metadataConfidence - a.metadataConfidence;
    if (b.seeders !== a.seeders) return b.seeders - a.seeders;
    return b.qualityScore - a.qualityScore;
  });
  return merged.slice(0, MAX_RESULTS);
}
async function runProvider(name, loader) {
  var state = providerState(name);
  var now = Date.now();
  if (state.circuitOpenUntil > now) {
    state.skippedRequests++;
    console.warn("[Torrentio Local] provider skipped (cooldown) " + name + " until " + new Date(state.circuitOpenUntil).toISOString());
    return [];
  }
  // Permit exactly one half-open probe after cooldown, even when Nuvio issues
  // several identical lookups concurrently.
  var isProbe = state.circuitOpenUntil > 0;
  if (isProbe && state.probeInFlight) {
    state.skippedRequests++;
    return [];
  }
  if (isProbe) state.probeInFlight = true;
  var started = Date.now();
  try {
    var streams = await loader();
    recordProvider(name, started, true, streams.length);
    return streams;
  } catch (error) {
    recordProvider(name, started, false, error);
    console.warn("[Torrentio Local] provider " + name + " [" + providerState(name).lastErrorKind + "]: " + (error && error.message ? error.message : error));
    return [];
  } finally {
    if (isProbe) state.probeInFlight = false;
  }
}
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    var kind = str(mediaType).toLowerCase();
    if (kind !== "movie" && kind !== "tv" && kind !== "series") return [];
    var requestedSeason = null;
    var requestedEpisode = null;
    if (kind !== "movie") {
      requestedSeason = Number(season);
      requestedEpisode = Number(episode);
      if (!Number.isSafeInteger(requestedSeason) || !Number.isSafeInteger(requestedEpisode) ||
          requestedSeason < 0 || requestedEpisode < 1) return [];
    }
    var imdbId = await imdbFor(tmdbId, kind === "movie" ? "movie" : "tv");
    var diagnostics = Object.create(null);
    var profile = getNetworkProfile();
    // Independent catalogs run concurrently; provider failures are isolated.
    var jobs = [runProvider("The RarBg", function() {
      return queryRarbgAdaptive(imdbId, kind, requestedSeason, requestedEpisode, diagnostics, profile);
    })];
    if (kind === "movie") {
      jobs.push(runProvider("YTS", async function() {
        return toStreams(await queryYts(imdbId), "movie", season, episode, diagnostics, profile);
      }));
    } else {
      jobs.push(runProvider("EZTV", async function() {
        return toStreams(await queryEztv(imdbId), kind, requestedSeason, requestedEpisode, diagnostics, profile);
      }));
    }
    var groups = await Promise.all(jobs);
    var combined = mergeProviderResults(groups);
    var thin = combined.filter(function(item) { return item.swarmHealth === "thin"; }).length;
    var large = combined.filter(function(item) { return item.networkFit === "large-for-profile"; }).length;
    console.info("[Torrentio Local] profile=" + profile + " sources=" + groups.length + " results=" + combined.length +
      " thinSwarms=" + thin + " largeForProfile=" + large + " rejected=" + JSON.stringify(diagnostics) +
      " health=" + Object.keys(providerHealth).map(function(name) {
        var state = providerHealth[name];
        return name + ":" + state.successes + "/" + state.requests + "@" + state.lastLatencyMs + "ms" +
          ":empty=" + state.emptyResponses + ":skipped=" + state.skippedRequests +
          ":last=" + state.lastOutcome +
          (state.circuitOpenUntil > Date.now() ? ":cooldown" : "") +
          (state.lastErrorKind ? ":" + state.lastErrorKind : "");
      }).join(","));
    return combined;
  } catch (err) {
    console.error("[Torrentio Local] " + (err && err.message ? err.message : err));
    return [];
  }
}
module.exports = { getStreams: getStreams };
