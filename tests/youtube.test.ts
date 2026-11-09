import {describe,it,expect} from 'vitest';
import {youtubeVideo,readerYouTubeVideos} from '../src/lib/reader-media';
import {extractArticle} from '../server/reader';
import {article,readerFixture} from './fixtures';
const id='-Fg41D19kWw';
describe('YouTube in article bodies',()=>{
 it('recognises watch, short, embed and privacy embed URLs and preserves a bounded timestamp',()=>{
  for(const url of [`https://www.youtube.com/watch?v=${id}`,`https://youtu.be/${id}`,`https://www.youtube.com/embed/${id}`,`https://www.youtube-nocookie.com/embed/${id}`,`https://m.youtube.com/shorts/${id}`])expect(youtubeVideo(url)?.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${id}`);
  expect(youtubeVideo(`https://youtu.be/${id}?t=90s`)?.embedUrl).toContain('?start=90');
 });
 it('only constructs players for exact YouTube hosts and video IDs',()=>{
  for(const u of [`https://youtube.com.evil.test/embed/${id}`,`https://user@www.youtube.com/embed/${id}`,'javascript:alert(1)','https://www.youtube.com/embed/invalid','https://www.youtube.com/redirect?url=https://evil.test',`https://www.youtube.com/watch?v=${id}&v=aaaaaaaaaaa`])expect(youtubeVideo(u)).toBeNull();
 });
 it('collects iframe-only and lazy videos before discarding arbitrary iframes, excluding ads',()=>{
  const d=extractArticle(`<div class="article-body-inner"><iframe src="https://www.youtube.com/embed/${id}"></iframe><iframe data-src="https://www.youtube.com/embed/abcdefghijk"></iframe><iframe src="http://[invalid"></iframe><div class="advertisement"><iframe src="https://www.youtube.com/embed/zzzzzzzzzzz"></iframe></div><aside><iframe src="https://www.youtube.com/embed/yyyyyyyyyyy"></iframe></aside></div>`,article());
  expect(readerYouTubeVideos(d).map(v=>v.id)).toEqual([id,'abcdefghijk']);
  expect(JSON.stringify(d)).not.toContain('<iframe');
 });
 it('supports cached article links and deduplicates the iframe plus watch link',()=>{
  const d=readerFixture(article());d.links=[{url:`https://www.youtube.com/embed/${id}`,title:'動画'},{url:`https://www.youtube.com/watch?v=${id}`,title:'動画'}];expect(readerYouTubeVideos(d)).toHaveLength(1);
 });
});
