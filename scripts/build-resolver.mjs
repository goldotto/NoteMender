// Resolve only files needed by the build. Avoid scanning unrelated parent folders.
import {readFile,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
export function localBuildResolver(root){
  const base=path.resolve(root),namespace='project-source';
  const exists=async p=>{try{return (await stat(p)).isFile();}catch{return false;}};
  async function relative(p){for(const f of [p,p+'.js',p+'.mjs',p+'.json',path.join(p,'index.js')])if(await exists(f))return f;throw Error('Cannot resolve '+p);}
  async function importOnly(specifier,importer){
    const name=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
    const subpath=specifier===name?'.':'./'+specifier.slice(name.length+1);
    for(let dir=path.dirname(importer);dir===base||dir.startsWith(base+path.sep);dir=path.dirname(dir)){
      const filename=path.join(dir,'node_modules',name,'package.json');if(!await exists(filename))continue;
      const pkg=JSON.parse(await readFile(filename,'utf8'));
      const condition=value=>typeof value==='string'?value:value&&typeof value==='object'?condition(value.browser)||condition(value.import)||condition(value.default):null;
      const target=condition(typeof pkg.exports==='string'?(subpath==='.'?pkg.exports:null):pkg.exports?.[subpath]||(subpath==='.'?pkg.exports:null));
      if(!target||!target.startsWith('./'))throw Error('No browser import export for '+specifier);
      return relative(path.resolve(path.dirname(filename),target));
    }
    throw Error('Cannot resolve browser import '+specifier);
  }
  return {name:'project-local-files',setup(build){
    build.onResolve({filter:/.*/},async args=>{
      if(['node-fetch','util','crypto','worker_threads','fs','string_decoder'].includes(args.path))return {path:args.path,namespace:'browser-empty'};
      const importer=path.isAbsolute(args.importer||'')?args.importer:path.join(base,'entry.mjs'),require=createRequire(importer);let resolved;
      if(path.isAbsolute(args.path)||args.path.startsWith('.'))resolved=await relative(path.resolve(args.resolveDir||path.dirname(importer),args.path));
      else{
        try{resolved=require.resolve(args.path);}catch(error){if(error.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw error;resolved=await importOnly(args.path,importer);}
        const packageName=args.path.startsWith('@')?args.path.split('/').slice(0,2).join('/'):args.path.split('/')[0];
        if(args.path===packageName){
          try{const filename=require.resolve(packageName+'/package.json'),pkg=JSON.parse(await readFile(filename,'utf8'));if(typeof pkg.browser==='string')resolved=path.resolve(path.dirname(filename),pkg.browser);else if(pkg.module)resolved=path.resolve(path.dirname(filename),pkg.module);}catch{}
        }
      }
      if(!resolved.toLowerCase().startsWith(base.toLowerCase()+path.sep))throw Error('Build dependency is outside the project: '+resolved);
      return {path:resolved,namespace};
    });
    build.onLoad({filter:/.*/,namespace:'browser-empty'},()=>({contents:'export default {};',loader:'js'}));
    build.onLoad({filter:/.*/,namespace},async args=>({contents:await readFile(args.path,'utf8'),resolveDir:path.dirname(args.path),loader:args.path.endsWith('.json')?'json':'js'}));
  }};
}
