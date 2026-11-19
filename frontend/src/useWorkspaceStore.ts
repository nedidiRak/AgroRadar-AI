import { useEffect, useRef, useState } from 'react'
import { apiFetch } from './authClient'
import { decodeWorkspace, freshWorkspace, type Workspace } from './workspaceLayout'

export function useWorkspaceStore(connected = true) {
  const [saved, setSaved] = useState(freshWorkspace)
  const [revision, setRevision] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [problem, setProblem] = useState<'load' | 'conflict' | 'damaged' | 'newer' | null>(null)
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)
  const pending = useRef(false)
  useEffect(() => {
    if (!connected) return
    const ctrl = new AbortController()
    async function load() {
      try {
        const response = await apiFetch('/api/me/layouts', { signal: ctrl.signal })
        if (!response.ok) throw new Error('Не удалось загрузить персональные макеты.')
        const data = await response.json()
        if (ctrl.signal.aborted) return
        if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('Сервер вернул неизвестную версию записи.')
        setRevision(data.revision)
        try {
          if (data.damaged || (data.revision > 0 && !data.workspace)) throw new Error('Повреждён сохранённый макет.')
          setSaved(data.workspace === null ? freshWorkspace() : decodeWorkspace(data.workspace))
          setProblem(null)
          setError('')
        } catch (err) {
          setSaved(freshWorkspace())
          setProblem(data.workspace?.version > 1 ? 'newer' : 'damaged')
          setError(err instanceof Error ? err.message : 'Не удалось прочитать макет.')
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setRevision(null)
          setProblem('load')
          setError(err instanceof Error ? err.message : 'Не удалось загрузить макеты.')
        }
      }
    }
    void load()
    return () => ctrl.abort()
  }, [reload,connected])
  async function save(workspace: Workspace) {
    if (!connected || revision === null || pending.current || problem === 'newer' || problem === 'conflict') return false
    pending.current = true
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch('/api/me/layouts', { method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({revision, workspace}) })
      if (response.status === 409) {
        setProblem('conflict')
        throw new Error('Этот макет изменён в другом окне. Загрузка новой версии отменит текущий черновик.')
      }
      if (!response.ok) throw new Error('Не удалось сохранить макет. Повтори сохранение.')
      const result = await response.json()
      setRevision(result.revision)
      setSaved(workspace)
      setProblem(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения.')
      return false
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return { saved, saving, error, problem, ready: !connected || (revision !== null && !problem),
    save, retry: () => { setRevision(null); setReload(n => n + 1) } }
}
