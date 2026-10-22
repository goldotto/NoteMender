import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {MAX_PACKAGE,MAX_EXPANDED,programPath} from './update-security.mjs';
const table=Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
export function crc32(b){let c=0xffffffff;for(const v of b)c=table[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function makeZip(files){
  const parts=[],central=[];let offset=0;
  for(const {path:name,data} of files){programPath(name);const bytes=Buffer.from(data),n=Buffer.from(name),compressed=deflateRawSync(bytes),crc=crc32(bytes),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);parts.push(h,n,compressed);offset+=h.length+n.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);
}
export function readZip(buffer,manifest){
  if(buffer.length>MAX_PACKAGE||buffer.length<22)throw Error('更新压缩包大小无效');let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
  if(end<0||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||buffer.readUInt16LE(end+8)!==buffer.readUInt16LE(end+10))throw Error('不支持分卷或损坏的更新压缩包');
  const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),start=buffer.readUInt32LE(end+16);
  if(count!==manifest.files.length||count>12000||start+size!==end)throw Error('压缩包与更新文件清单不符');
  const expected=new Map(manifest.files.map(f=>[f.path,f])),entries=[],seen=new Set();let pos=start,total=0;const ranges=[];
  for(let i=0;i<count;i++){
    if(pos+46>end||buffer.readUInt32LE(pos)!==0x02014b50)throw Error('压缩包目录损坏');const flags=buffer.readUInt16LE(pos+8),method=buffer.readUInt16LE(pos+10),crc=buffer.readUInt32LE(pos+16),compressed=buffer.readUInt32LE(pos+20),length=buffer.readUInt32LE(pos+24),n=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32),external=buffer.readUInt32LE(pos+38),local=buffer.readUInt32LE(pos+42);
    if(pos+46+n+extra+comment>end)throw Error('压缩包目录越界');const name=buffer.subarray(pos+46,pos+46+n).toString('utf8');programPath(name);
    if(flags!==0x800||![0,8].includes(method)||(external>>>16&0xf000)===0xa000||buffer.readUInt16LE(pos+34)||seen.has(name.toLowerCase())||!expected.has(name)||expected.get(name).size!==length||local+30>start)throw Error('更新压缩包包含重复、链接或无效条目');
    seen.add(name.toLowerCase());total+=length;if(total>MAX_EXPANDED)throw Error('解压大小超出限制');
    if(buffer.readUInt32LE(local)!==0x04034b50||buffer.readUInt16LE(local+6)!==flags||buffer.readUInt16LE(local+8)!==method||buffer.readUInt32LE(local+14)!==crc||buffer.readUInt32LE(local+18)!==compressed||buffer.readUInt32LE(local+22)!==length)throw Error('压缩包文件头不一致');
    const ln=buffer.readUInt16LE(local+26),le=buffer.readUInt16LE(local+28),dataAt=local+30+ln+le;if(buffer.subarray(local+30,local+30+ln).toString('utf8')!==name||dataAt+compressed>start)throw Error('压缩包文件越界');
    ranges.push([local,dataAt+compressed]);entries.push({path:name,crc,method,length,compressed:buffer.subarray(dataAt,dataAt+compressed)});pos+=46+n+extra+comment;
  }
  if(pos!==end)throw Error('压缩包目录长度不一致');ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])throw Error('压缩包条目重叠');
  return entries.map(e=>{const data=e.method===8?inflateRawSync(e.compressed,{maxOutputLength:Math.max(1,e.length)}):Buffer.from(e.compressed);if(data.length!==e.length||crc32(data)!==e.crc)throw Error('更新文件解压校验失败');return {path:e.path,data};});
}
