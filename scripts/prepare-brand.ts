import sharp from 'sharp';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const folder='public/brand';
const badge=await fs.readFile(`${folder}/source/heart-badge.png`);
const banner=await fs.readFile(`${folder}/source/banner.png`);
const badgeInfo=await sharp(badge).metadata();
const bannerInfo=await sharp(banner).metadata();
if(badgeInfo.width!==1254 || badgeInfo.height!==1254)throw new Error('Reinspect icon crop for changed source badge dimensions');
await sharp(badge).resize(256,256).png().toFile(`${folder}/sparkkindly-logo.png`);
await sharp(badge).resize(128,128).webp({quality:90}).toFile(`${folder}/badge-128.webp`);
// Crop only the supplied heart and spark, above the lettering and inside the ring.
// No redraw, recolouring, background removal or generated replacement artwork.
const mark=await sharp(badge).extract({left:300,top:125,width:650,height:575}).composite([{input:Buffer.from('<svg width="650" height="575"><path d="M0 0H100L0 100Z M650 0H550L650 100Z" fill="white"/></svg>')}]).png().toBuffer();
for(const size of [32,64,180,192,512]){
 await sharp(mark).resize(size,size,{fit:'contain',background:'#ffffff'}).png().toFile(`${folder}/icon-${size}.png`);
}
await fs.copyFile(`${folder}/icon-512.png`,`${folder}/icon.png`);
for(const width of [640,1280,1983]){
 await sharp(banner).resize({width,withoutEnlargement:true}).webp({quality:85}).toFile(`${folder}/banner-${width}.webp`);
}
await sharp(banner).resize(1200,630,{fit:'contain',background:'#fff7eb'}).jpeg({quality:90}).toFile(`${folder}/social-banner.jpg`);
const old=JSON.parse(await fs.readFile(`${folder}/manifest.json`,'utf8'));
await fs.writeFile(`${folder}/manifest.json`,JSON.stringify({
 status:'owner-supplied-assets-integrated',
 approvedLogo:'/brand/sparkkindly-logo.png',icon:'/brand/icon.png',socialBanner:'/brand/social-banner.jpg',
 provenance:{providedBy:'Site owner in this conversation',providedAt:'2026-10-17',permission:'Owner requested use in site, browser icon and banner. No independent copyright or model-release verification asserted.',rightsReview:'Owner provenance/license confirmation remains part of launch review'},
 originals:[{file:'source/heart-badge.png',originalFilename:'SparkKindly Heart Badge.png',sha256:createHash('sha256').update(badge).digest('hex'),width:badgeInfo.width,height:badgeInfo.height},{file:'source/banner.png',originalFilename:'SparkKindly_ Brighter Minds, Kinder Tomorrows.png',sha256:createHash('sha256').update(banner).digest('hex'),width:bannerInfo.width,height:bannerInfo.height}],
 derivatives:{logo:'Badge resized proportionally, full circle and lettering retained.',icon:'Heart and spark crop x=300 y=125 width=650 height=575; outer-ring corner remnants excluded with white corner masks; centered within a white square.',banner:'Full artwork, uncropped, responsive WebP sizes. Social derivative contains the whole image within 1200×630 cream canvas.'},
 previousStatus:old.previousStatus??'awaiting-owner-assets'
},null,2)+'\n');
console.log('Prepared owner-supplied logo, browser icons, full responsive banner and social image.');
