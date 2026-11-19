import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { browserOptions, button, chartGeometry, login, offlineTiles, settle } from './browser-helpers.mjs'

const screens = [[1920,1080],[1366,768],[1024,768],[768,1024],[390,844],[320,640]]
const views = ['Обзор','Карта и поля','Центр решений','ИИ-агроном','Пользователи']
const shell = process.env.PLAYWRIGHT_HEADLESS_SHELL === '1'
const systemDpi = process.argv.includes('--system-dpi')
const scaleName = systemDpi ? 'display DPI' : 'page zoom'
async function controls(page, label) {
  const outside = await page.evaluate(() => {
    const width=document.documentElement.clientWidth
    return [...document.querySelectorAll('button,select,textarea,input:not([type=hidden]),summary,a[href]')].filter(el=>{
      if (!el.checkVisibility() || !el.getClientRects().length) return false
      const rect=el.getBoundingClientRect()
      return rect.width>0 && rect.height>0 && (rect.left < -2 || rect.right > width+2)
    }).map(el => [el.tagName,el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim().slice(0,50),
      Math.round(el.getBoundingClientRect().x),Math.round(el.getBoundingClientRect().right)])
  })
  assert.deepEqual(outside,[],label+' controls outside viewport')
  const overflow = await page.evaluate(() => {
    const {scrollWidth,clientWidth} = document.documentElement
    if (scrollWidth <= clientWidth + 2) return null
    const beyond = [...document.querySelectorAll('body *')].filter(el => {
      return el.checkVisibility() && el.getBoundingClientRect().right > clientWidth + 2
    }).slice(0,12).map(el => [el.tagName,String(el.className),el.textContent?.trim().slice(0,24)])
    return {scrollWidth,clientWidth,beyond}
  })
  assert.equal(overflow,null,label+' horizontal overflow: '+JSON.stringify(overflow))
}
for (const zoom of [1,1.25,1.5]) {
  const dir = await mkdtemp(join(tmpdir(),'agroradar-zoom-'))
  const context = await chromium.launchPersistentContext(dir,{
    ...browserOptions,reducedMotion:'reduce',
    args:['--no-sandbox', ...(systemDpi ? [`--force-device-scale-factor=${zoom}`] : [])],
    ...(systemDpi ? {viewport:null} : {viewport:{width:1366,height:768}, deviceScaleFactor:shell ? zoom : 1}),
  })
  await offlineTiles(context)
  const page = context.pages()[0] ?? await context.newPage()
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  try {
    const display = systemDpi ? await context.newCDPSession(page) : null
    if (display) {
      // Check the native display scale before overriding the viewport dimensions.
      const dpr = await page.evaluate(() => devicePixelRatio)
      assert.ok(Math.abs(dpr-zoom)<.02, `Native display scale is ${dpr}, expected ${zoom}`)
    }
    // Full Chrome in CI uses its native page zoom. The optional headless-shell
    // runner has no settings UI and uses the equivalent CSS viewport and DPR.
    if (!shell && !systemDpi) {
      const settings=await context.newPage()
      await settings.goto('chrome://settings/appearance')
      await settings.evaluate(factor=>chrome.settingsPrivate.setDefaultZoom(factor),zoom)
      await settings.close()
    }
    await login(page)
    await page.locator('button[aria-label="Настройки интерфейса"]:visible').first().click()
    await button(page,'Максимальный').click()
    await button(page,'Готово').click()
    for (const [width,height] of screens) {
      if (display) {
        // A zero DPR override preserves the native scale of this Chrome process.
        await display.send('Emulation.setDeviceMetricsOverride',{width:Math.round(width/zoom),
          height:Math.round(height/zoom),deviceScaleFactor:0,mobile:false})
      } else {
        await page.setViewportSize({width:shell?Math.round(width/zoom):width,height:shell?Math.round(height/zoom):height})
      }
      await settle(page)
      const actual=await page.evaluate(()=>({width:innerWidth, dpr:devicePixelRatio}))
      assert.ok(Math.abs(actual.width-width/zoom)<=2 && Math.abs(actual.dpr-zoom)<.02,
        `Requested ${width} at ${zoom}, measured ${JSON.stringify(actual)}`)
      for (const name of views) {
        await button(page,name).click()
        await settle(page)
        await controls(page,`${width}×${height} @${zoom} ${name}`)
        if (name==='Обзор') {
          await page.locator('.temperature-plot:visible').first().waitFor()
          await chartGeometry(page)
          const clipped=await page.locator('.timeline-data:visible > div').evaluateAll(cards=>cards.filter(c=>c.scrollWidth>c.clientWidth+2).length)
          assert.equal(clipped,0,'hourly card contents fit')
          await button(page,'Настроить интерфейс').click()
          await button(page,'Добавить виджет').click()
          await controls(page,'Каталог '+width+' @'+zoom)
          await button(page,'Отменить изменения').click()
        }
        if(name==='Карта и поля') await page.locator('.agr-page--fields .leaflet-container').waitFor()
      }
      console.log(`PASS ${width}x${height} at ${zoom*100}% ${scaleName} (${actual.width} CSS px), five views, editor, chart labels and hourly values`)
    }
    assert.deepEqual(errors,[])
  } catch(error) {
    await page.screenshot({path:`browser-failure-${systemDpi?'dpi':'zoom'}-${zoom}.png`})
    throw error
  } finally { await context.close(); await rm(dir,{recursive:true,force:true}) }
}
