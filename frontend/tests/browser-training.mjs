import assert from 'node:assert/strict'
import {checkCard, visibleSpotlight} from './training-geometry.mjs'
import {button,launch,login,offlineTiles,saved,secret,settle,site,yandexContract} from './browser-helpers.mjs'

const browser=await launch()
const context=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'})
await offlineTiles(context)
await context.addInitScript(yandexContract)
const page=await context.newPage()
await page.route('**/api/ai/status',route=>route.fulfill({json:{configured:true,model:'test-model'}}))
await page.route('**/api/ai/check',route=>route.fulfill({json:{availability:'online',description:'Проверка в тесте'}}))
page.setDefaultTimeout(9000)
const errors=[],writes=[],providers=[]
page.on('pageerror',e=>errors.push(e.message))
page.on('request',r=>{
  const path=new URL(r.url()).pathname
  if(path.startsWith('/api/') && !['GET','HEAD'].includes(r.method()) && path!=='/api/me/onboarding') writes.push(path)
  if(['/api/ai/chat','/api/ai/check','/api/dashboard'].includes(path)) providers.push(path)
})
const card=page.locator('[data-training-step]')
const target=name=>page.locator('[data-learn="'+name+'"]:visible').first()
const next=()=>card.getByRole('button',{name:'Далее',exact:true}).click()
const skip=()=>card.getByRole('button',{name:'Пропустить шаг'}).click()
const at=async name=>{await page.locator('[data-training-step="'+name+'"]').waitFor(); await settle(page);await checkCard(page)}
async function sync(status,step){
  await page.waitForFunction(async ([status,step])=>{
    const r=await fetch('/api/me/onboarding')
    const p=await r.json()
    return p.status===status && p.step===step
  },[status,step])
}
async function settings(){
  await page.locator('[data-learn="settings"]:visible').first().click()
  return page.getByRole('dialog',{name:'Настройки интерфейса'})
}
async function reset(){
  await settings()
  const b=button(page,'Сбросить прогресс')
  if(await b.isVisible()) await b.click()
  await button(page,'Готово').click()
}
async function course(role){
  await at('welcome');await next()
  if(role==='admin'){await at('overview');await next()}
  await at('choose-field')
  await page.waitForFunction(()=>window.mapProbe.fits.length>0)
  const maps=await page.evaluate(()=>window.mapProbe.created)
  await target('field-choice').click()
  if(role==='admin'){await at('boundary');await next()}
  await at('weather');await visibleSpotlight(page,'forecast-chart');await next()
  await at('precipitation');await visibleSpotlight(page,'forecast-hourly');await next()
  await at('alerts');await visibleSpotlight(page,'alert-filter');await target('alert-filter').selectOption('open')
  await at('risk');assert.equal(await page.evaluate(()=>window.mapProbe.created),maps);await next()
  await at('question')
  await page.getByRole('textbox',{name:'Вопрос ИИ-агроному'}).fill('Какие признаки проверить на поле после холодной ночи?')
  await button(page,'Проверить вопрос').click()
  await at('interpret');await next()
  if(role==='admin'){
    await at('journal');await target('field-journal').click()
    await at('task');await target('new-task').click()
    await at('task-form')
    assert.ok(await page.locator('.agr-tasks-form:visible button[type=submit]').isDisabled())
    await next()
    await at('studio');await button(page,'Открыть учебный макет').click()
    await at('catalog');await target('catalog-toggle').click()
    await at('add-widget');await target('add-temperature').click()
    await at('move-widget')
    await target('practice-tools').getByRole('button',{name:'Выше: График температуры'}).click()
    await at('resize-widget')
    if(page.viewportSize().width===320){
      await sync('active','resize-widget')
      await page.reload()
      await button(page,'Продолжить обучение').click()
      await at('resize-widget')
    }
    const height=target('size-controls').getByRole('spinbutton')
    await height.fill('12');await height.press('Enter')
    await at('save-layout');await target('save-layout').click()
  }
  await at('finish');await button(page,'Завершить обучение').click()
  await sync('completed','finish')
  assert.equal(await card.count(),0)
}

try {
  await login(page)
  await button(page,'Начать обучение').waitFor()
  // Instrument only newly acquired resources after the dashboard has mounted.
  await page.evaluate(()=>{
    const observers=new Set(),listeners=new Map()
    for(const key of ['ResizeObserver','MutationObserver']){
      const Base=window[key]
      window[key]=class extends Base {
        observe(...args){observers.add(this);return super.observe(...args)}
        disconnect(){observers.delete(this);return super.disconnect()}
      }
    }
    for(const [index,target] of [window,document,visualViewport].entries()){
      const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target)
      function group(type,options){
        const key=[index,type,typeof options==='boolean'?options:!!options?.capture].join(':')
        if(!listeners.has(key))listeners.set(key,new Set())
        return listeners.get(key)
      }
      target.addEventListener=(type,fn,opts)=>{group(type,opts).add(fn);add(type,fn,opts)}
      target.removeEventListener=(type,fn,opts)=>{group(type,opts).delete(fn);remove(type,fn,opts)}
    }
    window.trainingResources=()=>[observers.size,[...listeners.values()].reduce((n,s)=>n+s.size,0)]
  })
  for(let i=0;i<4;i++){
    await button(page,i?'Продолжить обучение':'Начать обучение').click();await at('welcome')
    await page.keyboard.press('Escape');await sync('paused','welcome')
    await settle(page)
    const count=await page.evaluate(()=>window.trainingResources())
    if(i===0) await page.evaluate(c=>{window.trainingBaseline=c},count)
    assert.deepEqual(count,await page.evaluate(()=>window.trainingBaseline))
  }
  console.log('PASS repeated tour close releases observers and global handlers')
  await button(page,'Изучить самостоятельно').click()
  await sync('declined','welcome')
  await page.reload()
  await page.waitForSelector('.studio-primary:enabled')
  assert.equal(await page.locator('[data-training-welcome]').count(),0)
  await settings();await button(page,'Пройти обучение').click()
  await at('welcome');await next();await at('overview')
  await page.keyboard.press('Escape')
  await sync('paused','overview')
  await page.reload()
  await button(page,'Настроить интерфейс').click()
  await page.getByLabel('Название макета').fill('Черновик до обучения')
  await button(page,'Продолжить обучение').click()
  await at('overview')
  await card.getByRole('button',{name:'Назад'}).click()
  await at('welcome')
  const baseline=await saved(page)
  writes.length=0;providers.length=0
  await course('admin')
  assert.deepEqual(await saved(page),baseline)
  assert.equal(await page.getByLabel('Название макета').inputValue(),'Черновик до обучения')
  await button(page,'Отменить изменения').click()
  assert.deepEqual(writes,[])
  assert.deepEqual(providers,[])
  console.log('PASS full administrator course, real actions, safe AI and layout practice, skip, resume, back and persistence')

  await reset()
  const username='study_'+Date.now().toString(36)
  const csrf=(await (await page.request.get(site+'/api/auth/status')).json()).csrf_token
  assert.equal((await page.request.post(site+'/api/auth/users',{headers:{'X-Agro-CSRF':csrf},data:{username,password:secret}})).status(),201)
  await page.getByTitle('Выйти из системы').click();await page.locator('#agro-admin-password').waitFor()
  await login(page,username)
  await button(page,'Начать обучение').click()
  writes.length=0;providers.length=0
  await course('viewer');assert.deepEqual(writes,[]);assert.deepEqual(providers,[])
  assert.equal(await target('new-task').count(),0)
  assert.equal((await (await page.request.get(site+'/api/me/onboarding')).json()).role,'viewer')
  await reset()
  let deliver
  const barrier=new Promise(resolve=>{deliver=resolve})
  const delayDashboard=async route=>{await barrier;await route.continue()}
  await page.route('**/api/dashboard',delayDashboard)
  await page.reload({waitUntil:'domcontentloaded'})
  await button(page,'Начать обучение').click();await next()
  await at('choose-field')
  await card.getByText('Элемент сейчас недоступен',{exact:false}).waitFor()
  assert.ok(await page.getByText('Доступных полей пока нет.',{exact:true}).isVisible())
  deliver()
  await target('field-choice').click();await at('weather');await page.unroute('**/api/dashboard',delayDashboard);await page.keyboard.press('Escape')
  await sync('paused','weather')
  console.log('PASS missing field list, delayed dashboard and live target recovery')
  await page.getByTitle('Выйти из системы').click();await page.locator('#agro-admin-password').waitFor()
  await login(page)
  await button(page,'Начать обучение').waitFor()
  console.log('PASS observer route, account isolation, reset and prohibited farm actions absent')

  await button(page,'Настроить интерфейс').click()
  await page.getByLabel('Шаблон для компьютера').selectOption('minimal')
  const personal=await saved(page)
  await button(page,'Начать обучение').click();await next();await at('overview')
  await card.getByText('Виджет скрыт', {exact:false}).waitFor()
  await skip();await at('choose-field')
  await page.keyboard.press('Tab')
  assert.ok(await target('field-choice').evaluate(el=>el===document.activeElement))
  await page.keyboard.press('Enter');await at('boundary');await next();await at('weather')
  await card.getByText('Виджет скрыт',{exact:false}).waitFor()
  await skip();await at('precipitation')
  await card.getByText('Виджет скрыт',{exact:false}).waitFor()
  await skip();await at('alerts');await page.keyboard.press('Escape')
  await sync('paused','alerts')
  assert.deepEqual(await saved(page),personal)
  const help=page.locator('[data-context-help="ai"] button')
  await button(page,'ИИ-агроном').click();await help.focus()
  assert.equal(await help.getAttribute('aria-expanded'),'true')
  await page.keyboard.press('Escape');assert.equal(await help.getAttribute('aria-expanded'),'false')
  await button(page,'Обзор').click();await button(page,'Отменить изменения').click()
  console.log('PASS hidden widgets, keyboard access, contextual explanations and preserved personal layout')
  await reset()
  await page.setViewportSize({width:320,height:640})
  await button(page,'Начать обучение').click()
  await course('admin')
  console.log('PASS complete administrator practice at 320×640')
  assert.deepEqual(errors,[])
} catch(error){await page.screenshot({path:'browser-failure-training.png'});throw error}
finally{await browser.close()}
