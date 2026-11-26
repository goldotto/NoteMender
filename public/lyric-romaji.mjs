const kana=/[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const kanji=/\p{Script=Han}/u;

export function japaneseLyricLines(tokens){
  const lines=[];
  let line='',previousEnd=null;
  const flush=()=>{if(line)lines.push(line);line='';previousEnd=null;};
  for(const token of tokens){
    const parts=String(token.text||'').split(/\r?\n/);
    for(const [index,part] of parts.entries()){
      const text=part.trim();
      const japanese=kana.test(text)||token.language==='ja'||
        (line&&(!token.language||token.language==='auto')&&kanji.test(text));
      if(index||!japanese||(Number.isFinite(token.start)&&previousEnd!==null&&token.start-previousEnd>.85)||line.length>=80)flush();
      if(!japanese||!text)continue;
      line+=text;
      previousEnd=token.end??null;
      if(/[。！？!?]$/.test(text))flush();
    }
  }
  flush();
  return lines;
}

let reader;
export async function japaneseRomanizations(lines){
  reader??=import('./vendor/lyric-romaji.js').then(async ({Kuroshiro,KuromojiAnalyzer})=>{
    const converter=new Kuroshiro();
    await converter.init(new KuromojiAnalyzer({dictPath:'/vendor/romaji-dict'}));
    return converter;
  }).catch(error=>{reader=null;throw error;});
  const converter=await reader;
  return Promise.all(lines.map(text=>converter.convert(text,{to:'romaji',mode:'spaced',romajiSystem:'hepburn'})));
}
