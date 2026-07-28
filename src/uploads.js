const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const sharp = require("sharp");
const MAX = Math.min(Math.max(Number(process.env.MAX_UPLOAD_MB || 10), 1), 10);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX*1024*1024, files: 21, fields: 100 }, fileFilter(_r,f,cb){ if(!["image/jpeg","image/png","image/webp"].includes(f.mimetype)) return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE",f.fieldname)); return cb(null,true); } });
async function save(file, root, folder, width=2000, height=1500) {
  if(!file?.buffer) return ""; const dir=path.join(root,folder); fs.mkdirSync(dir,{recursive:true});
  const image=sharp(file.buffer,{failOn:"error",limitInputPixels:100_000_000}).rotate(); const m=await image.metadata();
  if(!m.width||!m.height||m.width>12000||m.height>12000) throw new Error("ขนาดภาพไม่เหมาะสม");
  const name=`${crypto.randomUUID()}.webp`; await image.resize({width,height,fit:"inside",withoutEnlargement:true}).webp({quality:84}).toFile(path.join(dir,name));
  return `/uploads/${folder}/${name}`;
}
function remove(p,root){if(!String(p||"").startsWith("/uploads/"))return;const t=path.resolve(root,p.slice(9)),r=path.resolve(root);if(!t.startsWith(r+path.sep))return;try{fs.unlinkSync(t);}catch(e){if(e.code!=="ENOENT")throw e;}}
module.exports={MAX,upload,save,remove};
