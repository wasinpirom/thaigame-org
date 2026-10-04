const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
process.env.NODE_ENV="test";process.env.SESSION_SECRET="test-secret-that-is-safely-long-enough";process.env.ADMIN_EMAIL="admin@test.local";process.env.ADMIN_PASSWORD="admin-pass-123";process.env.SITE_URL="http://localhost";
const{createApp}=require("../src/app");
async function boot(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thaigame-test-")),app=createApp({storageDir:dir}),server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));t.after(()=>{server.close();app.locals.db.close();fs.rmSync(dir,{recursive:true,force:true})});return{app,base:`http://127.0.0.1:${server.address().port}`}}
test("AI-only site: home, health, no member features",async t=>{const{base}=await boot(t);
 const h=await fetch(base+"/health");assert.deepEqual(await h.json(),{status:"ok"});
 const html=await (await fetch(base)).text();assert.match(html,/ข่าวเกมไทย/);assert.match(html,/Game Jam/);assert.doesNotMatch(html,/สมัครสมาชิก|เพิ่มผลงานเกม|\/register/);
 for(const[p,to]of[["/games","/news?kind=thai_game"],["/games/abc","/news?kind=thai_game"],["/games/new","/news?kind=thai_game"],["/developers/1","/news?kind=thai_game"],["/events","/jams"],["/register","/"],["/en","/"],["/en/games","/"],["/en/about","/about"]]){const r=await fetch(base+p,{redirect:"manual"});assert.equal(r.status,301,p);assert.equal(r.headers.get("location"),to,p)}
 assert.equal((await fetch(base+"/register",{method:"POST"})).status,404);});
test("admin login works and only admins can sign in",async t=>{const{app,base}=await boot(t);
 const page=await fetch(base+"/login"),cookie=page.headers.get("set-cookie").split(";")[0],tok=(await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
 const bad=await fetch(base+"/login",{method:"POST",redirect:"manual",headers:{cookie,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({_csrf:tok,email:"admin@test.local",password:"wrong"})});assert.equal(bad.status,401);
 const ok=await fetch(base+"/login",{method:"POST",redirect:"manual",headers:{cookie,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({_csrf:tok,email:"admin@test.local",password:"admin-pass-123"})});assert.equal(ok.status,302);
 const c2=ok.headers.get("set-cookie").split(";")[0];for(const p of ["/admin","/admin/news","/admin/feed","/admin/sources","/admin/jams","/admin/news/add"]){const r=await fetch(base+p,{headers:{cookie:c2}});assert.equal(r.status,200,p)}
 const t2=new Date().toISOString();app.locals.db.prepare("INSERT INTO users(email,password_hash,display_name,role,accepted_terms_at,created_at,updated_at) VALUES('m@x.y',?, 'member','member',?,?,?)").run(require("bcryptjs").hashSync("member-pass-1",4),t2,t2,t2);
 const p2=await fetch(base+"/login"),ck=p2.headers.get("set-cookie").split(";")[0],tk=(await p2.text()).match(/name="_csrf" value="([^"]+)"/)[1];
 const m=await fetch(base+"/login",{method:"POST",redirect:"manual",headers:{cookie:ck,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({_csrf:tk,email:"m@x.y",password:"member-pass-1"})});assert.equal(m.status,401);});
