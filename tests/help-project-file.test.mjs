import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,unlink} from 'node:fs/promises';
import {makeDemo,validateProject} from '../public/music.mjs';
import {PROJECT_FILE_LIMIT,readProjectFile,parseProjectText,projectText,assertProjectSize} from '../public/project-file.mjs';
import {SELECT_HELP,selectExplanation,parseManual,searchManual} from '../public/help-content.mjs';
import {createApp} from '../server.mjs';
function largeProject(){const project=makeDemo();project.lyrics=[{id:'test-word',text:'歌词',start:0,end:.5,noteIds:[project.notes[0].id],source:'manual',reviewed:true,language:'zh'}];project.alternates=Array.from({length:1200},(_,i)=>({id:'candidate-'+i,sectionId:'test',source:'vocals',method:'Basic Pitch',model:'nmp',audioStart:0,audioEnd:17,primary:false,notes:project.notes}));return validateProject(project);}
test('a long alternate survives project import without silently dropping notes',()=>{
 const p=makeDemo(),notes=Array.from({length:2100},(_,i)=>({id:'n-'+i,start:i/16,duration:1/16,midi:60}));
 p.alternates=[{id:'long',sectionId:'test',source:'vocals',notes}];
 assert.equal(parseProjectText(projectText(p)).alternates[0].notes.length,2100);
 const tooMany={...p,alternates:Array.from({length:2001},(_,i)=>({id:'alt-'+i,notes:[]}))};
 assert.throws(()=>parseProjectText(projectText(tooMany)),/备选.*2000/);
});
test('projects larger than 5 MB reopen with notes, lyrics and every alternate intact',async()=>{
 const value=largeProject(),text=projectText(value),file=new File([text],'大工程.json');assert.ok(file.size>5*1024*1024);assert.ok(file.size<PROJECT_FILE_LIMIT);
 const opened=await readProjectFile(file);assert.deepEqual(opened.notes,value.notes);assert.deepEqual(opened.lyrics,value.lyrics);assert.equal(opened.alternates.length,value.alternates.length);assert.equal(opened.alternates.at(-1).notes.length,value.alternates.at(-1).notes.length);assert.deepEqual(parseProjectText(projectText(opened)),opened);
});
test('project size guards match exports and invalid files fail before reading or replacing a project',async()=>{
 assert.doesNotThrow(()=>assertProjectSize(PROJECT_FILE_LIMIT));assert.throws(()=>assertProjectSize(PROJECT_FILE_LIMIT+1),/32 MB/);
 await assert.rejects(readProjectFile({size:PROJECT_FILE_LIMIT+1,text(){throw Error('must not read');}}),/32 MB/);
 assert.throws(()=>parseProjectText('{bad'),/JSON/);assert.throws(()=>parseProjectText('[]'),/音符列表/);assert.throws(()=>parseProjectText('{"notes":[]}'),/有效的简谱工程/);
 const value=makeDemo();assert.equal(parseProjectText('\uFEFF'+projectText(value)).notes.length,32);
});
test('recognition options have distinct explanations and manual search finds models, workflow and shortcuts',async()=>{
 for(const [id,choices] of Object.entries(SELECT_HELP))for(const [value,description] of Object.entries(choices))assert.equal(selectExplanation(id,value),description);
 assert.match(selectExplanation('recognitionProfile','pyin'),/概率单音/);assert.match(selectExplanation('recognitionProfile','crepe'),/tiny/);
 const chapters=parseManual(await readFile(new URL('../public/manual.txt',import.meta.url),'utf8'));assert.ok(chapters.length>=12);assert.ok(searchManual(chapters,'pYIN').length);assert.ok(searchManual(chapters,'Ctrl+X').length);assert.ok(searchManual(chapters,'歌词 原音').length);assert.equal(searchManual(chapters,'不存在的功能XYZ123').length,0);
 assert.deepEqual(searchManual(chapters,''),chapters);assert.ok(searchManual(chapters,'CREPE').length);assert.ok(searchManual(chapters,'32 MB').length);
});
test('server exports a large project that the importer can read byte for byte',async()=>{
 const app=createApp();await new Promise(r=>app.listen(0,'127.0.0.1',r));let filename;
 try{const base=`http://127.0.0.1:${app.address().port}`,{token}=await(await fetch(base+'/api/status')).json(),text=projectText(largeProject());
  const saved=await fetch(base+'/api/export-file?name=large-project-regression.json',{method:'POST',headers:{'x-studio-token':token},body:text});assert.equal(saved.status,200);const out=await saved.json();filename=out.filename;
  const reopened=await(await fetch(base+out.url)).text();assert.equal(reopened,text);assert.equal(parseProjectText(reopened).alternates.length,1200);
  const manual=await fetch(base+'/manual.txt');assert.equal(manual.status,200);assert.match(manual.headers.get('content-type'),/text\/plain/);
 }finally{await new Promise(r=>app.close(r));if(filename)await unlink(new URL('../exports/'+filename,import.meta.url));}
});
