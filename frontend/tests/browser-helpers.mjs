import assert from 'node:assert/strict'
import { chromium } from 'playwright'

export const site = 'http://127.0.0.1:5173'
export const secret = 'AgroRadar-Test-Only-Password!2026'
export const browserOptions = process.env.PLAYWRIGHT_HEADLESS_SHELL === '1' ? {headless:true} : {channel:'chrome', headless:true}
export const launch = () => chromium.launch({...browserOptions, args:['--no-sandbox']})
export const button = (page, name) => page.getByRole('button',{name,exact:true})
export async function login(page, username = 'admin', password = secret) {
  await page.goto(site)
  await page.locator('#agro-username').fill(username)
  await page.locator('#agro-admin-password').fill(password)
  await page.locator('.agro-login-card button[type=submit]').click()
  await page.waitForFunction(() => document.querySelector('.studio-primary')?.disabled === false)
}
export async function saved(page) {
  return (await page.request.get(site + '/api/me/layouts')).json()
}
export async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
export async function chartGeometry(page) {
  const issues = await page.locator('.temperature-plot:visible').evaluateAll(plots => {
    const issues = []
    const overlap = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    for (const plot of plots) {
      const svg = plot.querySelector('svg'), bounds = svg.getBoundingClientRect()
      const labels = [...svg.querySelectorAll('text')], times = labels.filter(t => t.dataset.axis === 'time')
      if (!times.length) issues.push('Нет отметок времени')
      labels.forEach((label,i) => {
        const a = label.getBoundingClientRect()
        if (a.left < bounds.left-1 || a.right > bounds.right+1 || a.top < bounds.top-1 || a.bottom > bounds.bottom+1)
          issues.push('Вне SVG: ' + label.textContent)
        labels.slice(i+1).forEach(other => { if (overlap(a,other.getBoundingClientRect())) issues.push(label.textContent+' / '+other.textContent) })
        if (label.dataset.axis === 'time') for (const mark of svg.querySelectorAll('circle,path,line')) {
          if (a.top < mark.getBoundingClientRect().bottom) issues.push('Пересечение оси и ряда: '+label.textContent)
        }
      })
    }
    return issues
  })
  assert.deepEqual(issues, [])
}
export async function offlineTiles(context) {
  await context.route('https://*.tile.openstreetmap.org/**', route => route.fulfill({
    contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>',
  }))
}

// Contract double only for the external Yandex 2.1 SDK. The actual map component,
// ResizeObserver, mode controls, GeoJSON and React lifecycles run in Chromium.
export function yandexContract() {
  window.mapProbe = {created:0, destroyed:0, fits:[]}
  class Collection { add(){} removeAll(){} options = {set(){}} }
  class Feature { events = {add(){}} }
  window.ymaps = {
    ready(fn){ fn() }, GeoObjectCollection:Collection, Placemark:Feature, Polygon:Feature,
    Polyline:Feature, Circle:Feature,
    Map:class {
      constructor(node, options) {
        window.mapProbe.created++
        this.type = options.type
        this.container = {fitToViewport:() => {window.mapProbe.fits.push([node.clientWidth,node.clientHeight])}}
      }
      geoObjects = new Collection()
      events = {add(){}}
      getType(){ return this.type }
      setType(value){ this.type=value; return Promise.resolve() }
      setCenter(){} setBounds(){} getZoom(){return 11} setZoom(){}
      destroy(){ window.mapProbe.destroyed++ }
    },
  }
}
