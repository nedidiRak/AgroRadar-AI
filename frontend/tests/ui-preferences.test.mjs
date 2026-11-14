import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadAppearance, saveAppearance, appearanceStorageKey } from '../src/uiAppearance.ts'
import {
  UI_FLAGS, initialPreferences, loadPreferences, savePreferences,
  preferencesStorageKey, presetOf, presetPreferences,
} from '../src/uiPreferences.ts'

function store() {
  const records = new Map()
  return {
    getItem: name => records.get(name) ?? null,
    setItem: (name, value) => records.set(name, value),
    records,
  }
}

test('mobile defaults remove clutter but keep real chat and navigation controls', () => {
  const prefs = initialPreferences(true)
  assert.equal(prefs.viewerNotice, false)
  assert.equal(prefs.aiContext, false)
  assert.equal(prefs.aiSuggestions, false)
  assert.equal(prefs.aiActions, false)
  assert.equal(prefs.aiTechnicalInfo, false)
  assert.equal(prefs.aiFieldPicker, true)
  assert.equal(prefs.aiStatus, true)
  assert.equal(prefs.navLabels, true)
  assert.equal(presetOf(prefs), 'compact')
})

test('desktop defaults retain useful context', () => {
  const prefs = initialPreferences(false)
  assert.equal(prefs.aiContext, true)
  assert.equal(prefs.aiSuggestions, true)
  assert.equal(prefs.weatherBadge, true)
  assert.equal(presetOf(prefs), 'balanced')
})

test('expert mode restores every optional block', () => {
  const prefs = presetPreferences('expert')
  assert.equal(Object.keys(prefs).length, UI_FLAGS.length)
  assert.ok(UI_FLAGS.every(key => prefs[key] === true))
  assert.equal(presetOf(prefs), 'expert')
})

test('preferences are saved independently for each account and device', () => {
  const browser = store()
  const alice = initialPreferences(true)
  alice.aiSuggestions = true
  alice.aiContext = true
  savePreferences(browser, 'agronom_1', alice)
  assert.deepEqual(loadPreferences(browser, 'agronom_1', true), alice)
  assert.equal(loadPreferences(browser, 'judge_2', true).aiSuggestions, false)
  assert.notEqual(preferencesStorageKey('agronom_1'), preferencesStorageKey('judge_2'))
  const otherDevice = store()
  assert.equal(loadPreferences(otherDevice, 'agronom_1', true).aiSuggestions, false)
})

test('bad storage, outdated versions and non-boolean flags never break rendering', () => {
  const browser = store()
  const key = preferencesStorageKey('agronom_1')
  browser.setItem(key, '{not json')
  assert.deepEqual(loadPreferences(browser, 'agronom_1', true), initialPreferences(true))
  browser.setItem(key, JSON.stringify({version:999,flags:{aiContext:true}}))
  assert.equal(loadPreferences(browser, 'agronom_1', true).aiContext, false)
  browser.setItem(key, JSON.stringify({version:1,flags:{aiContext:true,aiSuggestions:'yes',extraneous:false}}))
  const restored = loadPreferences(browser, 'agronom_1', true)
  assert.equal(restored.aiContext, true)
  assert.equal(restored.aiSuggestions, false)
  assert.equal('extraneous' in restored, false)
  const errors = {getItem(){throw Error('privacy mode')},setItem(){throw Error('quota')}}
  assert.deepEqual(loadPreferences(errors, 'x', true), initialPreferences(true))
  assert.doesNotThrow(()=>savePreferences(errors, 'x', restored))
})

test('all toggleable sections are exposed in the settings panel', () => {
  const panel = readFileSync(new URL('../src/UiSettings.tsx', import.meta.url),'utf8')
  for (const flag of UI_FLAGS) assert.ok(panel.includes("key:'" + flag + "'"), flag)
  assert.match(panel, /aria-modal="true"/)
  assert.match(panel, /onKey/)
  assert.match(panel, /onChange\(item.key,event.target.checked\)/)
})

test('the mobile bottom bar accommodates all 4 viewer or 5 admin destinations', () => {
  const css=readFileSync(new URL('../src/ui-mobile-fixes.css', import.meta.url),'utf8')
  const app=readFileSync(new URL('../src/main.tsx', import.meta.url),'utf8')
  assert.ok(css.includes('repeat(var(--agr-nav-count,4),minmax(0,1fr))'))
  assert.ok(app.includes("'--agr-nav-count':canEdit?5:4"))
  assert.ok(app.includes("onOpenSettings={()=>setSettingsOpen(true)}"))
  assert.ok(app.includes('ui.viewerNotice'))
})


test('visual themes and readable text options persist separately per user', () => {
  const browser = store()
  assert.deepEqual(loadAppearance(browser, 'a'), {theme:'forest',fontSize:'comfortable'})
  saveAppearance(browser, 'a', {theme:'ocean',fontSize:'large'})
  assert.deepEqual(loadAppearance(browser, 'a'), {theme:'ocean',fontSize:'large'})
  assert.deepEqual(loadAppearance(browser, 'b'), {theme:'forest',fontSize:'comfortable'})
  browser.setItem(appearanceStorageKey('a'), '{"theme":"script","fontSize":"tiny"}')
  assert.deepEqual(loadAppearance(browser, 'a'), {theme:'forest',fontSize:'comfortable'})
  browser.setItem(appearanceStorageKey('a'), '{broken')
  assert.deepEqual(loadAppearance(browser, 'a'), {theme:'forest',fontSize:'comfortable'})
})

test('compact and balanced presets visibly differ in statistics and risk details', () => {
  const compact=presetPreferences('compact')
  const balanced=presetPreferences('balanced')
  const expert=presetPreferences('expert')
  assert.equal(compact.overviewStats, false)
  assert.equal(compact.overviewRiskDetails, false)
  assert.equal(balanced.overviewStats, true)
  assert.equal(balanced.overviewRiskDetails, true)
  assert.equal(expert.aiTechnicalInfo, true)
  const css=readFileSync(new URL('../src/ui-appearance.css', import.meta.url),'utf8')
  for (const name of ['forest','ocean','graphite']) {
    assert.ok(readFileSync(new URL('../src/UiSettings.tsx', import.meta.url),'utf8').includes("id:'"+name+"'"))
  }
  assert.ok(css.includes('.agr-shell.agr-font--large,'))
  assert.ok(css.includes('.agr-ops-alert-actions button'))
})


test('all review-critical panels use the active palette rather than hard-coded forest greens', () => {
  const coverage = readFileSync(new URL('../src/ui-palette-coverage.css', import.meta.url), 'utf8')
  const accents = readFileSync(new URL('../src/ui-appearance.css', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  const map = readFileSync(new URL('../src/GeoFieldsMap.tsx', import.meta.url), 'utf8')

  assert.match(app, /import '\.\/ui-palette-coverage\.css'\s+import '\.\/ui-appearance\.css'/)
  for (const theme of ['ocean', 'graphite']) {
    for (const component of [
      '.agr-summary-strip', '.agr-weather-summary>div',
      '.agr-ops-banner', '.agr-ops-stats>div', '.agr-ops-monitor',
      '.agr-ops-alert', '.agr-ops-panel', '.agro-ai__message--assistant',
      '.agr-theme-choice', '.agr-settings-preset', '.agr-risk-engine',
    ]) {
      assert.ok(
        coverage.includes('agr-theme--'+theme+' '+component) ||
        accents.includes('agr-theme--'+theme+' '+component),
        theme+' is missing themed component '+component,
      )
    }
    assert.ok(coverage.includes('.agr-settings-panel.agr-theme--'+theme+' .agr-settings-switch'))
    assert.ok(accents.includes('.agr-shell.agr-theme--'+theme+' .agr-ops-chart svg path'))
  }
  assert.ok(map.includes('theme = \'forest\''))
  assert.ok(map.includes("theme === 'ocean'"))
  assert.ok(map.includes("theme === 'graphite'"))
  assert.ok(app.includes('theme={appearance.theme}'))
  assert.match(accents, /Preserve semantic risk colors/)
  assert.doesNotMatch(coverage, /[;{](?:width|height|font-size|padding|display|grid-template-columns):/)
})

test('all fixed text sizes follow the chosen scale, including phone, dialogs, charts and navigation', () => {
  const filenames = [
    'AgronomyInsights.css', 'AiAgronom.css', 'AuthGate.css', 'FallbackFieldsMap.css',
    'FieldTasks.css', 'FieldsManager.css', 'GeoFieldsMap.css', 'OperationsCenter.css',
    'RiskDashboard.css', 'UiSettings.css', 'UserManager.css', 'agronomy-v2.1.css',
    'layout-v1.2.css', 'mobile-v1.3.css', 'style.css', 'ui-appearance.css',
    'ui-mobile-fixes.css',
  ]
  let checked = 0
  for (const filename of filenames) {
    const css = readFileSync(new URL('../src/'+filename, import.meta.url),'utf8')
    for (const match of css.matchAll(/font-size\s*:\s*([^;}\n]+)/g)) {
      const value=match[1].trim()
      // Intentional icon-only mobile controls use 0. Relative em units inherit size.
      if (value==='0' || value==='0px' || value==='0.9em') continue
      assert.ok(value.includes('var(--agr-font-scale'), filename+' unscaled font-size: '+value)
      checked++
    }
  }
  assert.ok(checked >= 300, 'Expected to cover app typography rules')
  const appearance = readFileSync(new URL('../src/ui-appearance.css', import.meta.url),'utf8')
  for (const [mode, factor] of [['standard','1'], ['comfortable','1.14'], ['large','1.30']]) {
    assert.ok(appearance.includes('.agr-shell.agr-font--'+mode))
    assert.ok(appearance.includes('.agr-settings-panel.agr-font--'+mode))
    assert.ok(appearance.includes('--agr-font-scale:'+factor))
  }
  const panel = readFileSync(new URL('../src/UiSettings.tsx', import.meta.url),'utf8')
  assert.ok(panel.includes("' agr-font--'+appearance.fontSize"), 'Portal must receive scale class')
  const app = readFileSync(new URL('../src/main.tsx', import.meta.url),'utf8')
  assert.ok(app.includes('agr-font--') && app.includes('appearance.fontSize'), 'App shell must receive scale class')
  assert.ok(appearance.includes('svg text[font-size="11"]'))
})
