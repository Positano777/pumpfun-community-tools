// Build only. Runtime and generated viewer require no package installation.
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const {build}=process.argv[2] ? await import(pathToFileURL(resolve(process.argv[2])).href) : await import('esbuild');
const result=await build({entryPoints:[root+'receipt/viewer.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',minify:true});
const script=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script').trimEnd();
const hash=createHash('sha256').update(script).digest('base64');
const template=await readFile(root+'receipt/viewer-template.html','utf8');
await writeFile(root+'receipt/viewer.html',template.replace('__SCRIPT_HASH__',()=>hash).replace('__SCRIPT__',()=>script));
