import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
