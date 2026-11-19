import assert from 'node:assert/strict'
import { button, chartGeometry, launch, login, offlineTiles, secret, settle, site } from './browser-helpers.mjs'

const browser=await launch()
const context=await browser.newContext({viewport:{width:1536,height:900},reducedMotion:'reduce'})
const page=await context.newPage()
await offlineTiles(context)
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
try {
  await login(page)
  const csrf=(await (await page.request.get(site+'/api/auth/status')).json()).csrf_token
  const username='viewer_widgets_'+Date.now().toString(36)
  assert.equal((await page.request.post(site+'/api/auth/users',{headers:{'X-Agro-CSRF':csrf},data:{username,password:secret}})).status(),201)
  await page.getByTitle('Выйти из системы').click()
  await page.locator('#agro-admin-password').waitFor()
  await login(page,username)
  const viewerCsrf=(await (await page.request.get(site+'/api/auth/status')).json()).csrf_token
  const kinds=['map','temperature','analytics','risk','fiveDay',...Array.from({length:43},(_,i)=>['temperature','weather','hourly'][i%3])]
  const desktop=kinds.map((type,i)=>({id:'tile-'+i,type,x:i%2*6,y:Math.floor(i/2)*20,w:6,h:type==='map'?17:null}))
  const layout={id:'load',name:'48 виджетов',desktop,mobile:[desktop[1]]}
  const put=await page.request.put(site+'/api/me/layouts',{headers:{'X-Agro-CSRF':viewerCsrf},data:{
    revision:0,workspace:{version:1,active:'load',layouts:[layout]},
  }})
  assert.equal(put.status(),200)
  let fixture='crossing'
  await page.route('**/api/dashboard', async route=>{
    const data=await (await route.fetch()).json()
    const forecast=data.fields[0].forecast
    const cases={empty:[],single:[0],edge:[9.4,9.7,7.5,5.8,5.6,4.2,3,3.4],crossing:[-0.7,-0.2,2,4.2,6,3.5,1,0]}
    const values=cases[fixture]
    forecast.points=values.map((temperature_c,i)=>({temperature_c,timestamp:1781956800+i*10800,precipitation_probability_pct:i===0?100:0,rain_mm_3h:0}))
    forecast.min_temperature_next_24h_c=fixture==='empty'?null:fixture==='edge'?2.1:Math.min(...values)
    await route.fulfill({json:data})
  })
  await page.reload()
  const map=page.locator('[data-widget="map"]')
  const markerLayer=map.locator('.leaflet-overlay-pane svg').first()
  await markerLayer.waitFor({state:'attached'})
  const before=await markerLayer.boundingBox()
  assert.ok(before && before.width>0)
  await page.locator('[data-widget="analytics"] button').first().click()
  await page.waitForFunction(()=>document.querySelector('[data-widget="analytics"] .agr-v4-card, [data-widget="analytics"] .agr-v4-error'))
  await button(page,'Настроить интерфейс').click()
  await chartGeometry(page)
  const handle=map.locator('.react-resizable-handle-se')
  await handle.scrollIntoViewIfNeeded()
  await settle(page)
  const bounds=await handle.boundingBox()
  const requests=[]
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(r.url())})
  await page.evaluate(()=>{
    window.gridFrames=[]
    let previous=performance.now()
    function tick(now) {window.gridFrames.push(now-previous);previous=now;window.gridRaf=requestAnimationFrame(tick)}
    window.gridRaf=requestAnimationFrame(tick)
  })
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2)
  await page.mouse.down()
  await page.mouse.move(bounds.x-110,bounds.y-90,{steps:30})
  await page.mouse.up()
  await page.waitForFunction(size=>{
    const svg=document.querySelector('[data-widget="map"] .leaflet-overlay-pane svg')
    const rect=svg?.getBoundingClientRect()
    return rect && Math.abs(rect.width-size.width)>30 && Math.abs(rect.height-size.height)>30
  },before)
  const frames=await page.evaluate(()=>{cancelAnimationFrame(window.gridRaf);return window.gridFrames.slice(1).sort((a,b)=>a-b)})
  const p95=frames[Math.floor(frames.length*.95)]
  assert.ok(frames.length>=10 && p95 < 200,`48 widgets, ${frames.length} frames, p95 ${p95}ms`)
  assert.deepEqual(requests,[])
  assert.equal(await page.locator('.studio-tile').count(),48)
  await button(page,'Отменить изменения').click()
  console.log(`PASS real Leaflet viewport, 48 widgets, ${frames.length} frames during resize, p95 ${p95.toFixed(1)} ms, no API calls`)
  for (fixture of ['empty','edge','single']) {
    await page.setViewportSize({width:320,height:640})
    await page.reload()
    if(fixture==='empty') {
      await page.locator('[data-widget="temperature"] .timeline-empty').waitFor()
      assert.equal(await page.locator('.temperature-plot').count(),0)
      continue
    }
    await page.waitForSelector('.temperature-plot circle')
    assert.equal(await page.locator('.temperature-plot circle').count(),fixture==='edge'?8:1)
    await chartGeometry(page)
    if(fixture==='single') {
      assert.equal(await page.locator('text[data-axis=time]').count(),1)
      assert.ok(await page.locator('text[data-axis=temperature]').allTextContents().then(labels=>labels.includes('0°C')))
    }
  }
  let future=false, writes=0
  await page.route('**/api/me/layouts',route=>{
    if(route.request().method()==='PUT'){ writes++;return route.continue() }
    return route.fulfill({json:future?{revision:1,workspace:{version:99}}:{revision:1,damaged:true,workspace:null}})
  })
  await page.reload()
  await button(page,'Восстановить стандартный макет').waitFor()
  assert.equal(writes,0,'damaged settings were silently replaced')
  future=true
  await page.reload()
  await page.getByRole('alert').filter({hasText:'не поддерживается'}).waitFor()
  assert.equal(await button(page,'Настроить интерфейс').isDisabled(),true)
  assert.equal(writes,0)
  assert.deepEqual(errors,[])
  console.log('PASS chart at zero crossing, screenshot range, empty forecast and single point; damaged and future formats protected')
} catch(error) {await page.screenshot({path:'browser-failure-widgets.png'});throw error}
finally {await browser.close()}
