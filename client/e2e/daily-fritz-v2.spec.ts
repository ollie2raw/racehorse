import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const authState = path.resolve(process.cwd(), '.auth/daily-fritz-qa.json');
function hasValidAuthState(filePath:string){
  if(!fs.existsSync(filePath))return false;
  try{
    const state=JSON.parse(fs.readFileSync(filePath,'utf8')) as {origins?:Array<{localStorage?:Array<{name?:string;value?:string}>}>};
    return state.origins?.some((origin)=>origin.localStorage?.some((entry)=>{
      if(!entry.name?.startsWith('sb-')||!entry.name.endsWith('-auth-token')||!entry.value)return false;
      const session=JSON.parse(entry.value) as {expires_at?:unknown};
      return typeof session.expires_at==='number'&&session.expires_at>Date.now()/1000+60;
    }))??false;
  }catch{return false;}
}
function runtimeGuard(page: Page) { const errors:string[]=[]; page.on('pageerror',(error)=>errors.push(error.message)); page.on('console',(message)=>{if(message.type()==='error')errors.push(message.text());}); return()=>expect(errors,errors.join('\n')).toEqual([]); }
async function openDailyFritz(page:Page){await page.goto('/daily-fritz');await expect(page.getByRole('heading',{name:'Daily Fritz'})).toBeVisible({timeout:20_000});}

test.describe('Daily Fritz v2 official lifecycle',()=>{
  test.skip(!hasValidAuthState(authState),'A current authenticated Daily Fritz QA fixture is required');
  test('starts and resumes the exact official match snapshot',async({browser},testInfo)=>{
    test.setTimeout(90_000);
    const context=await browser.newContext({storageState:authState,viewport:{width:1440,height:900}});const page=await context.newPage();const assertClean=runtimeGuard(page);
    try{
      await openDailyFritz(page);await page.screenshot({path:testInfo.outputPath('daily-fritz-pre-run.png'),fullPage:true});
      const action=page.locator('.df-pvf-start-btn');await expect(action).toBeEnabled();await action.click();
      await expect(page.locator('.bot-match-screen.bot-match-mode-daily-fritz')).toBeVisible({timeout:30_000});
      await page.screenshot({path:testInfo.outputPath('daily-fritz-active.png'),fullPage:true});
      const playable=page.locator('.hand-container button.domino-tile:not(.unplayable):not(.disabled)').first();
      if(await playable.isVisible().catch(()=>false)){await playable.click();const end=page.locator('.placement-zone.active').first();if(await end.isVisible().catch(()=>false))await end.click();}
      const before=await page.evaluate(()=>{const key=Object.keys(localStorage).find((value)=>value.startsWith('racehorse:daily-fritz:v3:'));return key?localStorage.getItem(key):null;});
      expect(before).not.toBeNull();const parsed=JSON.parse(before!);expect(parsed.schemaVersion).toBe(5);
      await page.reload();await expect(page.getByRole('heading',{name:'Daily Fritz'})).toBeVisible({timeout:30_000});await page.locator('.df-pvf-start-btn').click();await expect(page.locator('.bot-match-screen.bot-match-mode-daily-fritz')).toBeVisible({timeout:30_000});
      const after=await page.evaluate(()=>{const key=Object.keys(localStorage).find((value)=>value.startsWith('racehorse:daily-fritz:v3:'));return key?localStorage.getItem(key):null;});
      expect(JSON.parse(after!).match.players.you.score).toBe(parsed.match.players.you.score);expect(JSON.parse(after!).match.players.bot.score).toBe(parsed.match.players.bot.score);expect(JSON.parse(after!).match.board).toEqual(parsed.match.board);
      assertClean();
    }finally{await context.close();}
  });
});
