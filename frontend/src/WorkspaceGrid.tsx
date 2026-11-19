import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowDown, ArrowUp, EyeOff, GripVertical, SlidersHorizontal } from 'lucide-react'
import GridLayout, { useContainerWidth, type Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import { columns, limits, reorder, widgets, type Device, type Tile } from './workspaceLayout'

const row = 30, gap = 10
type FrameProps = {
  tile: Tile; editing: boolean; controls: ReactNode; children: ReactNode
  measure: (id: string, rows: number) => void
}
function Frame({ tile, editing, controls, children, measure }: FrameProps) {
  const body = useRef<HTMLDivElement>(null)
  const tools = useRef<HTMLDivElement>(null)
  useEffect(() => () => measure(tile.id, 0), [tile.id, measure])
  useLayoutEffect(() => {
    if (tile.h !== null) return
    const content = body.current!
    const toolbar = tools.current
    let frame = 0
    function update() {
      if (!content.offsetWidth) return
      const height = content.offsetHeight + (toolbar?.offsetHeight ?? 0) + 2
      measure(tile.id, Math.max(1, Math.ceil((height + gap) / (row + gap))))
    }
    update()
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    })
    observer.observe(content)
    if (toolbar) observer.observe(toolbar)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [tile.h, tile.id, editing, measure])
  return <div className={'studio-frame' + (tile.h === null ? ' studio-frame--auto' : ' studio-frame--sized')}>
    {editing && <div ref={tools} className="studio-tools">{controls}</div>}
    <div className="studio-scroll"><div className="studio-content" ref={body}>{children}</div></div>
  </div>
}

// Layout coordinates do not participate in the render contract of the actual widgets.
const WidgetContent = memo(function WidgetContent({ render, type, id, fieldId }: {
  render: RenderWidget; type: Tile['type']; id: string; fieldId?: number | null
}) { return <>{render(type, id, fieldId)}</> })
export type RenderWidget = (type: Tile['type'], id: string, fieldId?: number | null) => ReactNode

export default function WorkspaceGrid({ tiles, device, editing, onChange, render, onInspect, onHide }: {
  tiles: Tile[]; device: Device; editing: boolean; onChange: (next: Tile[]) => void
  render: RenderWidget; onInspect: (id: string) => void; onHide: (id: string) => void
}) {
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true })
  const [heights, setHeights] = useState<Record<string, number>>({})
  const measure = useCallback((id: string, height: number) => {
    setHeights(prev => {
      if ((prev[id] ?? 0) === height) return prev
      const next = {...prev}
      if (height) next[id] = height
      else delete next[id]
      return next
    })
  }, [])
  const cols = columns(device)
  const layout = useMemo(() => tiles.map(tile => {
    const def = widgets[tile.type]
    const minH = tile.h === null && !editing ? 1 : def.minH
    return { i: tile.id, x: tile.x, y: tile.y, w: tile.w, h: Math.max(minH, tile.h ?? heights[tile.id] ?? def.minH),
      minW: Math.min(cols, def.minW), minH, maxH: tile.h === null ? undefined : limits.height }
  }), [tiles, cols, editing, heights])
  function commit(next: Layout, resized?: string) {
    if (!editing) return
    const byId = new Map(next.map(item => [item.i, item]))
    onChange(tiles.map(tile => {
      const item = byId.get(tile.id)
      return item ? { ...tile, x: item.x, y: item.y, w: item.w,
        h: tile.id === resized ? Math.min(item.h, limits.height) : tile.h } : tile
    }))
  }
  const sorted = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x)
  return <div ref={containerRef as RefObject<HTMLDivElement>} className={'studio-canvas' + (editing ? ' studio-canvas--edit' : '')}
    style={{ '--studio-cols': cols } as React.CSSProperties}>
    {mounted && <GridLayout width={Math.max(width, 1)} layout={layout}
      gridConfig={{cols, rowHeight:row, margin:[gap,gap], containerPadding:[0,0]}}
      dragConfig={{enabled:editing, handle:'.studio-grip', allowMobileScroll:true}}
      resizeConfig={{enabled:editing, handles:device === 'mobile' ? ['s'] : ['se','e','s']}}
      onDragStop={next => commit(next)}
      onResizeStop={(next, _, item) => commit(next, item?.i)}>
      {sorted.map((tile, index) => {
        const title = widgets[tile.type].title
        return <div key={tile.id} className="studio-tile" data-widget={tile.type} data-instance={tile.id} aria-label={title}>
          <Frame tile={tile} editing={editing} measure={measure} controls={<>
            <span className="studio-grip" title={'Перетащить: ' + title}><GripVertical size={17}/>{title}</span>
            <div className="studio-tile-actions">
              <button type="button" aria-label={'Выше: ' + title} title="Выше" disabled={!index} onClick={() => onChange(reorder(tiles,tile.id,-1))}><ArrowUp/></button>
              <button type="button" aria-label={'Ниже: ' + title} title="Ниже" disabled={index === sorted.length-1} onClick={() => onChange(reorder(tiles,tile.id,1))}><ArrowDown/></button>
              <button type="button" aria-label={'Параметры: ' + title} title="Размер и поле" onClick={() => onInspect(tile.id)}><SlidersHorizontal/></button>
              <button type="button" aria-label={'Скрыть: ' + title} title="Скрыть виджет" onClick={() => onHide(tile.id)}><EyeOff/></button>
            </div>
          </>}>
            <WidgetContent render={render} id={tile.id} type={tile.type} fieldId={tile.fieldId}/>
          </Frame>
        </div>
      })}
    </GridLayout>}
  </div>
}
