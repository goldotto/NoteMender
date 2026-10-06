import test from 'node:test';import assert from 'node:assert/strict';
import {shortcutAction,SHORTCUTS} from '../public/shortcuts.mjs';
const key=(value,extra={})=>({key:value,...extra});
test('editing shortcuts provide pitch, timing, lyric splitting and standard clipboard actions',()=>{
 assert.equal(shortcutAction(key('ArrowUp')),'up');assert.equal(shortcutAction(key('ArrowDown',{shiftKey:true})),'downOctave');assert.equal(shortcutAction(key('[')),'shorter');assert.equal(shortcutAction(key('L')),'lyricSplit');assert.equal(shortcutAction(key('S',{shiftKey:true})),'splitMiddle');assert.equal(shortcutAction(key('m')),'merge');assert.equal(shortcutAction(key('s',{ctrlKey:true})),'save');assert.equal(shortcutAction(key('v',{ctrlKey:true})),'paste');assert.equal(shortcutAction(key('z',{ctrlKey:true,shiftKey:true})),'redo');assert.equal(shortcutAction(key('ArrowLeft',{altKey:true})),'backThree');assert.equal(shortcutAction(key('a',{metaKey:true})),'selectAll');
 assert.ok(SHORTCUTS.some(x=>/歌词切分/.test(x[2])));
});
test('switch, text entry, dialogs and IME keep editing keys from running',()=>{
 for(const context of [{enabled:false},{editing:true},{dialog:true},{busy:true}])for(const e of [key('Delete'),key('ArrowUp'),key('l'),key('v',{ctrlKey:true}),key(' ')])assert.equal(shortcutAction(e,context),null);
 assert.equal(shortcutAction(key('k',{ctrlKey:true,altKey:true}),{enabled:false,editing:true,dialog:true}),'toggle');
 assert.equal(shortcutAction(key('k',{ctrlKey:true,altKey:true,isComposing:true})),null);assert.equal(shortcutAction(key('s',{keyCode:229})),null);assert.equal(shortcutAction(key('l',{defaultPrevented:true})),null);
 assert.equal(shortcutAction(key('s',{ctrlKey:true,altKey:true})),null);
 assert.equal(shortcutAction(key('c',{ctrlKey:true,shiftKey:true})),null);
});
test('holding a key cannot repeat cut, merge, save or toggle; arrow and duration adjustment may repeat',()=>{
 for(const e of [key('s'),key('m'),key('l'),key('Delete'),key('s',{ctrlKey:true}),key(' '),key('k',{ctrlKey:true,altKey:true})])assert.equal(shortcutAction({...e,repeat:true}),null);
 assert.equal(shortcutAction(key('ArrowUp',{repeat:true})),'up');assert.equal(shortcutAction(key(']',{repeat:true})),'longer');
});
