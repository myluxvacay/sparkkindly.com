import fs from 'node:fs/promises';
import sharp from 'sharp';
// References are self-hosted; approval/provenance remains in manifest.json.
for(const file of (await fs.readdir('public/images')).filter(f=>/^[a-z]+\.webp$/.test(f))){
 for(const width of [480,960,1600]){
  const base=`public/images/${file.replace('.webp','')}-${width}`;
  await sharp(`public/images/${file}`).resize({width,withoutEnlargement:true}).webp({quality:75}).toFile(`${base}.webp`);
  await sharp(`public/images/${file}`).resize({width,withoutEnlargement:true}).avif({quality:45}).toFile(`${base}.avif`);
 }
}
console.log('Generated local WebP and AVIF variants at 480, 960, 1600px.');
