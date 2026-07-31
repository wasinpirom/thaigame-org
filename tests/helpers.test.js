const test=require("node:test"),assert=require("node:assert/strict"),H=require("../src/helpers");
test("YouTube URLs",()=>{assert.equal(H.youtubeId("https://youtu.be/dQw4w9WgXcQ"),"dQw4w9WgXcQ");assert.equal(H.youtubeId("https://youtube.com/watch?v=dQw4w9WgXcQ"),"dQw4w9WgXcQ");assert.equal(H.youtubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),"dQw4w9WgXcQ");assert.equal(H.youtubeId("https://example.com/video"),"")});
test("external URLs",()=>{assert.equal(H.externalUrl("javascript:alert(1)"),"");assert.equal(H.externalUrl("https://example.com/game"),"https://example.com/game")});
test("selection allow-list",()=>assert.deepEqual(H.selected(["Web","Bad","Web"],["Web","Windows"]),["Web"]));
