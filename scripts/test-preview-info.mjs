import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import test from 'node:test';

// Import the real pure parser; only resolve its browser-bundler import for Node.
const source=stripTypeScriptTypes(readFileSync('src/preview-info.ts','utf8')).replace("'./preview-metadata'",JSON.stringify(pathToFileURL(resolve('src/preview-metadata.ts')).href));
const {commentsFrom,descriptionFrom,commentsSeed,safeUrl,safeImage}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const fixture=name=>JSON.parse(readFileSync(`scripts/fixtures/preview-info/${name}.json`,'utf8'));
test('modern native comment entities join their displayed rows, sort choices and pagination',()=>{
 const page=commentsFrom(fixture('top'));
 assert.equal(page.items.length,20);assert.equal(page.sorts.length,2);assert.equal(page.sorts[0].selected,true);
 assert.ok(page.next);assert.ok(page.items[0].text.includes('1:23'));assert.equal(page.items[0].likes,'378');assert.ok(page.items[0].replies);
 const newest=commentsFrom(fixture('newest'));assert.equal(newest.items.length,20);assert.equal(newest.sorts[1].selected,true);
});
test('nested native reply threads keep inline children and their own continuation',()=>{
 const page=commentsFrom(fixture('replies'));assert.equal(page.items.length,3);assert.equal(page.next,undefined);
 const flat=items=>items.flatMap(c=>[c,...flat(c.inlineReplies)]), replies=flat(page.items);
 assert.equal(replies.length,6);assert.equal(replies.filter(c=>c.replies).length,1);
});
test('description timestamps seek this video while external links stay links',()=>{
 const text='Intro 1:23 More';
 const data={videoSecondaryInfoRenderer:{attributedDescription:{content:text,commandRuns:[
  {startIndex:6,length:4,onTap:{innertubeCommand:{watchEndpoint:{videoId:'sample00001',startTimeSeconds:83}}}},
  {startIndex:11,length:4,onTap:{innertubeCommand:{urlEndpoint:{url:'https://example.com/'}}}},
 ]}}};
 const result=descriptionFrom(data,{videoDetails:{title:'Sample',author:'Creator'}},'sample00001');
 assert.equal(result.runs.map(r=>r.text).join(''),text);assert.equal(result.runs[1].seek,83);assert.equal(result.runs.at(-1).url,'https://example.com/');
 assert.equal(result.title,'Sample');assert.equal(safeUrl('javascript:alert(1)'),undefined);assert.equal(safeImage('https://example.com/avatar'),undefined);
});
test('comments seed selects comments rather than unrelated continuations; disabled comments remain explicit',()=>{
 const command=token=>({continuationCommand:{token}});
 assert.equal(commentsSeed({contents:[{itemSectionRenderer:{targetId:'live-chat',contents:[command('wrong')]}},{itemSectionRenderer:{targetId:'comments-section',contents:[command('right')]}}]}),'right');
 const p=commentsFrom({messageRenderer:{text:{simpleText:'Comments disabled'}}});assert.equal(p.items.length,0);assert.equal(p.message,'Comments disabled');
});
