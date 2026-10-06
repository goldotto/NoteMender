import {writeFile,mkdir} from 'node:fs/promises';
import {wavBytes} from '../public/audio.mjs';
import {makeDemo,scoreSVG,midiFile} from '../public/music.mjs';
const sr=22050,notes=[60,62,64,65,67,69,71,72],samples=new Float32Array(sr*5);
for(let i=0;i<notes.length;i++)for(let j=0;j<sr*.42;j++){const t=j/sr,env=Math.min(1,t/.02,Math.max(0,(.42-t)/.04));samples[Math.floor((.4+i*.5)*sr)+j]=.5*Math.sin(2*Math.PI*440*2**((notes[i]-69)/12)*t)*env;}
await mkdir('examples',{recursive:true});await writeFile('examples/C大调音阶-120BPM.wav',wavBytes(samples));
const project=makeDemo();await writeFile('examples/晴日小调.json',JSON.stringify(project,null,2));await writeFile('examples/晴日小调.svg',scoreSVG(project));await writeFile('examples/晴日小调.mid',midiFile(project));
console.log('示例与测试音频已生成');
