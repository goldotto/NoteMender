const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inline=value=>{
  let html='',end=0;
  for(const match of String(value).matchAll(/`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^\s)]+)\)/g)){
    html+=escape(value.slice(end,match.index));
    if(match[1])html+=`<code>${escape(match[1])}</code>`;
    else if(match[2])html+=`<strong>${inline(match[2])}</strong>`;
    else {
      let safe=false;try{safe=['https:','http:'].includes(new URL(match[4]).protocol);}catch{}
      html+=safe?`<a href="${escape(match[4])}" target="_blank" rel="noopener noreferrer">${inline(match[3])}</a>`:escape(match[3]);
    }
    end=match.index+match[0].length;
  }
  return html+escape(value.slice(end));
};
// Deliberately limited Markdown: all remote text is escaped before any markup.
export function releaseNotesHTML(text=''){
  const output=[];let list=false,fence=false,code=[];
  const closeList=()=>{if(list){output.push('</ul>');list=false;}};
  for(const line of String(text).split(/\r?\n/)){
    if(/^\s*```/.test(line)){closeList();if(fence){output.push('<pre><code>'+escape(code.join('\n'))+'</code></pre>');code=[];}fence=!fence;continue;}
    if(fence){code.push(line);continue;}
    const heading=/^\s*(#{1,6})\s+(.+)$/.exec(line),item=/^\s*[-*]\s+(.+)$/.exec(line);
    if(heading){closeList();const level=Math.min(6,heading[1].length+2);output.push(`<h${level}>${inline(heading[2])}</h${level}>`);}
    else if(item){if(!list){output.push('<ul>');list=true;}output.push('<li>'+inline(item[1])+'</li>');}
    else{closeList();if(line.trim())output.push('<p>'+inline(line)+'</p>');}
  }
  closeList();if(fence)output.push('<pre><code>'+escape(code.join('\n'))+'</code></pre>');return output.join('');
}
