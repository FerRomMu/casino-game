import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist');
await cp('src','dist/src',{recursive:true});
await cp('content','dist/content',{recursive:true});
await cp('assets','dist/assets',{recursive:true});
const html = (await readFile('index.html','utf8')).replace('<html lang="es">','<html lang="es" data-build="production">');
await writeFile('dist/index.html',html);
console.log('Built dist/');
