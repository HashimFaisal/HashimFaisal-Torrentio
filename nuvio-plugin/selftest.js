const assert = require("node:assert/strict");
global.TMDB_API_KEY = "test-key";
let mode = "movie";
let transientFailures = 0;
let forcedIndexStatus = 0;
let forcedYtsStatus = 0;
let forcedEztvStatus = 0;
const calls = [];
global.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).includes("/search/?") && forcedIndexStatus) {
    return {ok:false,status:forcedIndexStatus,json:async()=>({})};
  }
  if (String(url).includes("/search/?") && transientFailures > 0) {
    transientFailures--;
    return {ok:false,status:503,headers:{get:()=>null},json:async()=>({})};
  }
  if (String(url).includes("movies-api.accel.li") && forcedYtsStatus) {
    return {ok:false,status:forcedYtsStatus,headers:{get:()=>null},json:async()=>({})};
  }
  if (String(url).includes("eztvx.to/api/get-torrents") && forcedEztvStatus) {
    return {ok:false,status:forcedEztvStatus,headers:{get:()=>null},json:async()=>({})};
  }
  if (String(url).includes("movies-api.accel.li")) {
    const imdb = new URL(String(url)).searchParams.get("query_term");
    const h = (mode==="metadata" ? "2" : "7").repeat(40);
    return {ok:true,status:200,json:async()=>({status:"ok",data:{movies:[{
      imdb_code:imdb,title:"Provider Movie",title_long:"Provider Movie (2026)",
      torrents:[{hash:h,quality:"480p",type:"web",seeds:1,peers:40,size_bytes:700000000,
        magnet_url:"magnet:?xt=urn:btih:"+h}]
    }]}})};
  }
  if (String(url).includes("eztvx.to/api/get-torrents")) {
    const h = "8".repeat(40);
    return {ok:true,status:200,json:async()=>({torrents:[
      {hash:h,filename:"Breaking.Bad.S01E01.Pilot.720p",magnet_url:"magnet:?xt=urn:btih:"+h,
       seeds:12,peers:2,size_bytes:"1500000000",season:"1",episode:"1"},
      {hash:"9".repeat(40),filename:"Breaking.Bad.S01E02.720p",
       magnet_url:"magnet:?xt=urn:btih:"+"9".repeat(40),seeds:30,peers:2,
       size_bytes:"1500000000",season:"1",episode:"2"}
    ]})};
  }
  if (String(url).includes("/external_ids?")) {
    const imdbId = String(url).includes("/525252/") ? "tt525252" :
      String(url).includes("/626262/") ? "tt626262" :
      String(url).includes("/424242/") ? "tt424242" :
      String(url).includes("/636363/") ? "tt636363" :
      String(url).includes("/646464/") ? "tt646464" :
      String(url).includes("/656565/") ? "tt656565" :
      String(url).includes("/676767/") ? "tt676767" :
      String(url).includes("/686868/") ? "tt686868" :
      String(url).includes("/696969/") ? "tt696969" :
      String(url).includes("/747474/") ? "tt747474" :
      String(url).includes("/757575/") ? "tt757575" :
      mode==="movie" ? "tt1375666" : mode==="tv" ? "tt0903747" : "tt1234567";
    return {ok:true,status:200,json:async()=>({imdb_id:imdbId})};
  }
  const hash = (c) => c.repeat(40);
  const rows = mode==="metadata" ? [
    {name:"Example.Release.1080p.BluRay",infoHash:hash("2"),magnet:"magnet:?xt=urn:btih:"+hash("2"),seeders:25,leechers:2,resolution:"1080p",size:2200000000,source:"BluRay",codec:"x265"},
    {name:"Example.Release.1080p.BluRay.REPACK",infoHash:hash("2"),magnet:"magnet:?xt=urn:btih:"+hash("2"),seeders:60,leechers:4,resolution:"1080p",size:2200000000},
    {name:"Base32.hash.release.720p.BluRay.x265.HDR10+.Atmos",infoHash:"A".repeat(32),magnet:"magnet:?xt=urn:btih:"+"A".repeat(32),seeders:18,leechers:2,resolution:"720p",size:1200000000},
    {name:"Example.Release.720p.WEB",infoHash:hash("3"),magnet:"magnet:?xt=urn:btih:"+hash("3"),seeders:500,leechers:1,resolution:"2160p",size:900000000,source:"WEB",codec:"x264"},
    {name:"fractional swarm",infoHash:hash("4"),magnet:"magnet:?xt=urn:btih:"+hash("4"),seeders:3.5,leechers:1,resolution:"1080p",size:900000000},
    {name:"verification unavailable",infoHash:hash("5"),magnet:"magnet:?xt=urn:btih:"+hash("5"),seeders:20,leechers:1,resolution:"1080p",size:900000000,verifile:"unknown"},
    {name:"invalid quality score",infoHash:hash("7"),magnet:"magnet:?xt=urn:btih:"+hash("7"),seeders:15,leechers:1,resolution:"1080p",size:900000000,qualityScore:"NaN"},
    {name:"duplicate with valid score",infoHash:hash("7"),magnet:"magnet:?xt=urn:btih:"+hash("7"),seeders:18,leechers:1,resolution:"1080p",size:900000000,qualityScore:12},
    {name:"failed verification",infoHash:hash("6"),magnet:"magnet:?xt=urn:btih:"+hash("6"),seeders:20,leechers:1,resolution:"1080p",size:900000000,verifile:"failed"}
  ] : mode==="movie" ? [
    {name:"Inception 2160p",infoHash:hash("a"),magnet:"magnet:?xt=urn:btih:"+hash("a"),seeders:80,leechers:80,resolution:"2160p",size:1000000000},
    {name:"Inception 720p",infoHash:hash("e"),magnet:"magnet:?xt=urn:btih:"+hash("e"),seeders:20,leechers:2,resolution:"720p",size:3000000000},
    {name:"Inception 720p crowded",infoHash:hash("f"),magnet:"magnet:?xt=urn:btih:"+hash("f"),seeders:20,leechers:80,resolution:"720p",size:3000000000},
    {name:"wrong magnet hash",infoHash:hash("g"),magnet:"magnet:?xt=urn:btih:"+hash("h"),seeders:99,leechers:0,resolution:"1080p",size:1000000000},
    {name:"bad",infoHash:"bad",magnet:"magnet:?xt=urn:btih:bad",seeders:10}
  ] : [
    {name:"Breaking.Bad.S01E01.Pilot.1080p",infoHash:hash("b"),magnet:"magnet:?xt=urn:btih:"+hash("b"),seeders:50,resolution:"1080p",season:1,episode:1,size:1500000000},
    {name:"Breaking.Bad.S01E01-07.PACK",infoHash:hash("c"),magnet:"magnet:?xt=urn:btih:"+hash("c"),seeders:60,season:1,episode:1,size:5000000000},
    {name:"Breaking.Bad.S02E01.1080p",infoHash:hash("d"),magnet:"magnet:?xt=urn:btih:"+hash("d"),seeders:60,season:2,episode:1,size:1500000000}
  ];
  return {ok:true,status:200,json:async()=>({results:rows})};
};
const {getStreams}=require("./torrentio.js");
(async()=>{
  let r=await getStreams("27205","movie",null,null);
  assert.equal(r.length,4); assert.equal(r[0].networkProfile,"medium");
  assert.equal(r[0].networkFit,"recommended-size");
  assert.equal(r[0].infoHash,"e".repeat(40)); assert.equal(typeof r[0].size,"number"); assert.equal(r[0].swarmHealth,"healthy"); assert.equal(r[1].infoHash,"a".repeat(40)); assert.equal(r[2].infoHash,"f".repeat(40)); assert.equal(r[2].swarmHealth,"thin"); assert.ok(!r.some(x=>x.infoHash==="g".repeat(40)), "rejects magnet/infoHash mismatch");
  assert.ok(calls.some(x=>x.includes("imdb=tt1375666")), "IMDb id must be sent to The RarBg");
  assert.ok(calls.some(x=>x.includes("movies-api.accel.li") && x.includes("query_term=tt1375666")), "YTS must receive the exact IMDb id");
  assert.deepEqual(calls.filter(x=>x.includes("/search/?")).map(x=>Number((x.match(/min_seeders=(\d+)/)||[])[1])),[10,5,1]);
  mode="tv"; calls.length=0;
  r=await getStreams("1396","tv",1,1);
  assert.equal(r.length,2); assert.equal(r[0].networkProfile,"fast");
  assert.ok(r.some(x=>x.infoHash==="b".repeat(40)));
  assert.ok(r.some(x=>x.infoHash==="8".repeat(40)), "EZTV exact episode result must be included");
  assert.ok(!r.some(x=>x.infoHash==="9".repeat(40)), "EZTV other episodes must be excluded");
  assert.match(calls[1],/season=1&episode=1/);
  assert.deepEqual(calls.filter(x=>x.includes("/search/?")).map(x=>Number((x.match(/min_seeders=(\d+)/)||[])[1])),[10,5,1]);

  // Repeating the same lookup should be served from the short-lived cache.
  const beforeRepeat = calls.length;
  const repeated = await getStreams("1396","tv",1,1);
  assert.equal(repeated.length,2);
  assert.equal(calls.length,beforeRepeat,"cached lookup must not issue duplicate network requests");

  // Concurrent identical lookups should share in-flight TMDB and index requests.
  mode="concurrent";
  const beforeConcurrent = calls.length;
  await Promise.all([
    getStreams("424242","movie",null,null),
    getStreams("424242","movie",null,null)
  ]);
  assert.equal(calls.length-beforeConcurrent,5,
    "two simultaneous lookups should share one TMDB request, three index requests, and one YTS request");

  // Two transient 503 responses should recover on the third attempt.
  mode="movie"; calls.length=0; transientFailures=2;
  const recovered = await getStreams("525252","movie",null,null);
  assert.equal(recovered.length,4);
  const recoveredSearches = calls.filter(x=>x.includes("/search/?"));
  assert.equal(recoveredSearches.length,5,
    "two 503 retries plus the remaining adaptive thresholds should complete");
  assert.equal(recoveredSearches[0],recoveredSearches[1]);
  assert.equal(recoveredSearches[1],recoveredSearches[2]);

  // Permanent malformed-request failures must not be retried; auth cooldown is tested at the end.
  calls.length=0; forcedIndexStatus=400;
  const unauthorized = await getStreams("626262","movie",null,null);
  assert.ok(unauthorized.some(x=>x.infoHash==="7".repeat(40)),
    "YTS results must survive a permanent The RarBg authentication failure");
  assert.equal(calls.filter(x=>x.includes("/search/?")).length,1,
    "HTTP 400 must fail fast while the independent YTS provider remains available");
  forcedIndexStatus=0;

  // Metadata confidence and invalid metadata rejection.
  mode="metadata"; calls.length=0;
  const metadataResults=await getStreams("737373","movie",null,null);
  assert.equal(metadataResults.length,5);
  const merged=metadataResults.find(x=>x.infoHash==="2".repeat(40));
  assert.ok(merged);
  assert.ok(merged.duplicateCount >= 2,
    "duplicate rows with the same infoHash across search thresholds must collapse into one result");
  assert.equal(merged.seeders,60,
    "merged duplicate should retain the strongest available swarm count");
  assert.equal(merged.metadataConfidence,85,
    "merged duplicate should preserve the strongest confidence supported by the fixture metadata");
  assert.ok(merged.alternateTitles.includes("Example.Release.1080p.BluRay.REPACK"));
  assert.ok(merged.providers.includes("YTS"), "same BTIH returned by YTS and The RarBg must merge into one result with both provider labels");
  const base32Result=metadataResults.find(x=>x.infoHash==="0".repeat(40));
  assert.ok(base32Result,
    "Base32 BTIH infoHash and magnet should normalize to the same canonical hexadecimal hash");
  assert.equal(base32Result.source,"BluRay","release source should be inferred from a recognized title tag");
  assert.equal(base32Result.codec,"HEVC","video codec should be normalized from x265 title tags");
  assert.equal(base32Result.hdr,"HDR10+","HDR format should be inferred without claiming verified metadata");
  assert.equal(base32Result.audio,"Atmos","audio format should be inferred from release title tags");
  assert.ok(base32Result.metadataWarnings.includes("codec-inferred-from-title"));
  const mismatch=metadataResults.find(x=>x.infoHash==="3".repeat(40));
  assert.ok(mismatch);
  assert.equal(mismatch.quality,"720p",
    "conflicting structured/title resolution must use the conservative lower value");
  assert.ok(mismatch.metadataWarnings.includes("resolution-conflict"));
  assert.ok(mismatch.metadataConfidence<100);
  assert.ok(!metadataResults.some(x=>x.infoHash==="4".repeat(40)),
    "fractional swarm counts must be rejected");
  assert.ok(metadataResults.some(x=>x.infoHash==="5".repeat(40)),
    "unknown verification state must not be mistaken for a failed verdict");
  const invalidScore=metadataResults.find(x=>x.infoHash==="7".repeat(40));
  assert.ok(invalidScore, "a malformed optional quality score must not discard an otherwise valid stream");
  assert.equal(invalidScore.qualityScore,0, "malformed quality scores must normalize to zero");
  assert.ok(invalidScore.qualityScoreWarnings.includes("invalid-quality-score"),
    "malformed quality scores must be visible in diagnostics");
  assert.equal(invalidScore.qualityScore,12,
    "a valid duplicate quality score may improve the merged optional score");
  assert.ok(invalidScore.qualityScoreWarnings.includes("invalid-quality-score"),
    "merging a valid duplicate must not erase the malformed-score diagnostic");
  assert.ok(!metadataResults.some(x=>x.infoHash==="6".repeat(40)),
    "explicit failed verification must be rejected");

  // Three consecutive YTS outages open its circuit; a later lookup skips YTS during cooldown.
  forcedYtsStatus=503; calls.length=0;
  await getStreams("636363","movie",null,null);
  await getStreams("646464","movie",null,null);
  await getStreams("656565","movie",null,null);
  calls.length=0;
  await getStreams("676767","movie",null,null);
  assert.equal(calls.filter(x=>x.includes("movies-api.accel.li")).length,0,
    "a provider with repeated failures must be skipped during its cooldown");
  forcedYtsStatus=0;

  // After cooldown, concurrent lookups must share exactly one half-open probe.
  const realNow = Date.now;
  Date.now = () => realNow() + 61000;
  calls.length=0;
  await Promise.all([
    getStreams("686868","movie",null,null),
    getStreams("696969","movie",null,null)
  ]);
  Date.now = realNow;
  assert.equal(calls.filter(x=>x.includes("movies-api.accel.li")).length,1,
    "only one concurrent lookup may probe a recovering provider");

  // Authentication failures should be classified and cooled down immediately.
  mode="tv"; forcedEztvStatus=403; calls.length=0;
  await getStreams("747474","tv",1,1);
  assert.equal(calls.filter(x=>x.includes("eztvx.to/api/get-torrents")).length,1);
  forcedEztvStatus=0; calls.length=0;
  await getStreams("757575","tv",1,1);
  assert.equal(calls.filter(x=>x.includes("eztvx.to/api/get-torrents")).length,0,
    "an endpoint with an authentication failure must be bypassed during its extended cooldown");

  console.log("PASS: multi-provider fan-out, provider isolation and circuit breaking, latency-driven network profiles, cross-source deduplication, swarm ranking, Base32 BTIH compatibility, magnet integrity, episode filtering, cache/coalescing, retry recovery, and metadata validation.");
})().catch(e=>{console.error(e);process.exitCode=1;});
