const assert = require("node:assert/strict");
global.TMDB_API_KEY = "test-key";
let mode = "movie";
const calls = [];
global.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).includes("/external_ids?")) {
    return {ok:true,status:200,json:async()=>({imdb_id:mode==="movie"?"tt1375666":"tt0903747"})};
  }
  const hash = (c) => c.repeat(40);
  const rows = mode==="movie" ? [
    {name:"Inception 2160p",infoHash:hash("a"),magnet:"magnet:?xt=urn:btih:"+hash("a"),seeders:80,resolution:"2160p",size:1000000000},
    {name:"bad",infoHash:"bad",magnet:"magnet:?xt=urn:btih:bad",seeders:10}
  ] : [
    {name:"Breaking.Bad.S01E01.Pilot.1080p",infoHash:hash("b"),magnet:"magnet:?xt=urn:btih:"+hash("b"),seeders:50,resolution:"1080p",season:1,episode:1},
    {name:"Breaking.Bad.S01E01-07.PACK",infoHash:hash("c"),magnet:"magnet:?xt=urn:btih:"+hash("c"),seeders:60,season:1,episode:1},
    {name:"Breaking.Bad.S02E01.1080p",infoHash:hash("d"),magnet:"magnet:?xt=urn:btih:"+hash("d"),seeders:60,season:2,episode:1}
  ];
  return {ok:true,status:200,json:async()=>({results:rows})};
};
const {getStreams}=require("./torrentio.js");
(async()=>{
  let r=await getStreams("27205","movie",null,null);
  assert.equal(r.length,1); assert.equal(r[0].quality,"2160p");
  assert.match(calls[1],/imdb=tt1375666/);
  mode="tv"; calls.length=0;
  r=await getStreams("1396","tv",1,1);
  assert.equal(r.length,1); assert.equal(r[0].infoHash,"b".repeat(40));
  assert.match(calls[1],/season=1&episode=1/);
  console.log("PASS: movie lookup, magnet/hash validation, exact TV episode filtering, season-pack rejection.");
})().catch(e=>{console.error(e);process.exitCode=1;});
