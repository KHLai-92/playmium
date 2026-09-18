import assert from 'node:assert/strict';
import test from 'node:test';
import { assignedJSON, extractChapters } from '../src/preview-metadata.ts';

test('watch JSON parsing respects braces in strings and never evaluates trailing script', () => {
  const data={title:'A {nested} "title"',items:[{x:3}]};
  assert.deepEqual(assignedJSON('var ytInitialData = '+JSON.stringify(data)+'; throw new Error("never execute")','var ytInitialData ='),data);
  assert.equal(assignedJSON('var ytInitialData = {bad};','var ytInitialData ='),null);
});
test('native chapter and marker renderers are normalized, sorted and deduplicated', () => {
  const data={markers:[{chapterRenderer:{title:{simpleText:'Second'},timeRangeStartMillis:60000}},
    {chapterRenderer:{title:{runs:[{text:'Intro'}]},timeRangeStartMillis:0}},
    {macroMarkersListItemRenderer:{title:{simpleText:'Intro duplicate'},onTap:{watchEndpoint:{startTimeSeconds:0}}}},
    {macroMarkersListItemRenderer:{title:{simpleText:'Third'},onTap:{innertubeCommand:{watchEndpoint:{startTimeSeconds:120}}}}}]};
  const chapters=extractChapters(data);
  assert.deepEqual(chapters.map(c=>c.start),[0,60,120]);
  assert.equal(chapters[1].title,'Second'); assert.equal(chapters[2].title,'Third');
});
test('unrelated timestamps and malformed chapters are not invented as native chapters', () => {
  assert.deepEqual(extractChapters({comments:[{title:'At 2:30',startTimeSeconds:150}],chapterRenderer:{title:{simpleText:'Invalid'},timeRangeStartMillis:'bad'}}),[]);
});
