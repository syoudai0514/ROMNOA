import {test,expect} from '@playwright/test';
import {article,feed,readerFixture} from '../fixtures';
test('YouTube is embedded automatically without a second click, with a working external link',async({page})=>{
 const a=article(0,{title:'YouTube記事'});const url='https://www.youtube.com/watch?v=-Fg41D19kWw';
 await page.route(/\/api\/yahoo(?:-topics)?(?:\?|$)/,r=>r.abort());
 await page.route('**/api/articles',r=>r.fulfill({json:{...feed,articles:[a]}}));
 await page.route('**/api/reader?**',r=>r.fulfill({json:{...readerFixture(a),links:[{url,title:'YouTubeの動画'}]}}));
 await page.route('https://www.youtube-nocookie.com/**',r=>r.fulfill({contentType:'text/html',body:'<p>公式プレーヤー</p>'}));
 await page.goto('/');await page.getByRole('group',{name:'配信チャンネル'}).getByRole('button',{name:'まとめ',exact:true}).click();
 await page.getByTestId('article-row').first().getByRole('button',{name:/^記事を開く/}).click();
 const section=page.getByRole('region',{name:'YouTubeの動画'});const player=section.locator('iframe');
 await expect(player).toBeVisible();await expect(player).toHaveAttribute('src','https://www.youtube-nocookie.com/embed/-Fg41D19kWw');
 await expect(player).toHaveAttribute('referrerpolicy','strict-origin-when-cross-origin');
 await expect(section.getByRole('link',{name:'YouTubeで開く'})).toHaveAttribute('href',url);
});
