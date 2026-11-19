import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { SmartApp } from '~/apps/model'
import type { InstalledModuleRecord } from '~/modules/types'

export type SmartAppsFilter = 'all' | 'web-tool' | 'mini-app'
export type SmartAppsSort = 'default' | 'name-asc' | 'name-desc'

interface SmartAppsListProps {
  apps: SmartApp[]
  modules: InstalledModuleRecord[]
  query: string
  filter: SmartAppsFilter
  sort: SmartAppsSort
  openApp: (_id: string) => unknown
  openModule: (_id: string) => unknown
  toggleApp: (_id: string, _enabled: boolean) => Promise<unknown>
  toggleModule: (_id: string, _enabled: boolean) => Promise<unknown>
  editApp: (_app: SmartApp) => unknown
  removeApp: (_app: SmartApp) => unknown
  onError: (_error: unknown) => void
}

type SmartAppsRow = {
  id: string
  name: string
  description: string
  enabled: boolean
  kind: SmartApp['kind']
  label: string
} & ({ source: 'app', app: SmartApp } | { source: 'module', record: InstalledModuleRecord })

const columns: ColumnDef<SmartAppsRow>[] = [
  {
    accessorKey: 'name',
    sortingFn: (left, right) => left.original.name.localeCompare(right.original.name, 'zh-CN', { numeric: true, sensitivity: 'base' }),
  },
  {
    accessorKey: 'kind',
    enableGlobalFilter: false,
    filterFn: (row, columnId, value: SmartAppsFilter) => row.getValue(columnId) === value,
  },
]

function SmartAppsList(props: SmartAppsListProps) {
  const data = useMemo<SmartAppsRow[]>(() => [
    ...props.modules.map((record): SmartAppsRow => ({
      id: `module:${record.manifest.id}`,
      source: 'module',
      record,
      name: record.manifest.name,
      description: record.manifest.description,
      enabled: record.enabled,
      kind: 'mini-app',
      label: record.manifest.runtime === 'builtin' ? '内置小应用' : '远程小应用',
    })),
    ...props.apps.map((app): SmartAppsRow => ({
      id: `app:${app.id}`,
      source: 'app',
      app,
      name: app.name,
      description: app.description,
      enabled: app.enabled,
      kind: app.kind,
      label: app.kind === 'web-tool' ? '网页标准工具' : '小应用',
    })),
  ], [props.apps, props.modules])
  const sorting = useMemo<SortingState>(() => props.sort === 'default' ? [] : [{ id: 'name', desc: props.sort === 'name-desc' }], [props.sort])
  const columnFilters = useMemo<ColumnFiltersState>(() => props.filter === 'all' ? [] : [{ id: 'kind', value: props.filter }], [props.filter])
  const table = useReactTable({
    data,
    columns,
    getRowId: row => row.id,
    state: {
      globalFilter: props.query,
      columnFilters,
      sorting,
    },
    globalFilterFn: (row, _columnId, value: string) => `${row.original.name} ${row.original.description}`.toLocaleLowerCase().includes(value.toLocaleLowerCase()),
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const rows = table.getRowModel().rows
  const virtualized = rows.length > 50
  const scroll = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    enabled: virtualized,
    getScrollElement: () => scroll.current,
    getItemKey: index => rows[index].id,
    estimateSize: () => 110,
    overscan: 5,
    initialRect: { width: 0, height: 600 },
  })
  useLayoutEffect(() => {
    if (virtualized) {
      virtualizer.measure()
      virtualizer.scrollToOffset(0)
    }
  }, [props.query, props.filter, props.sort, virtualized, virtualizer])

  const pending = useRef(new Set<string>())
  const [pendingIds, setPendingIds] = useState(new Set<string>())
  const mounted = useRef(true)
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const invoke = (action: () => unknown) => {
    try {
      void Promise.resolve(action()).catch(props.onError)
    }
    catch (error) { props.onError(error) }
  }
  const toggle = async (row: SmartAppsRow) => {
    if (pending.current.has(row.id))
      return
    pending.current.add(row.id)
    setPendingIds(new Set(pending.current))
    try {
      if (row.source === 'app')
        await props.toggleApp(row.app.id, !row.enabled)
      else
        await props.toggleModule(row.record.manifest.id, !row.enabled)
    }
    finally {
      pending.current.delete(row.id)
      if (mounted.current)
        setPendingIds(new Set(pending.current))
    }
  }
  const card = (row: SmartAppsRow) => (
    <article className="smart-app-row" data-app-id={row.source === 'app' ? row.app.id : undefined} data-module-id={row.source === 'module' ? row.record.manifest.id : undefined}>
      <button type="button" className="smart-app-switch" role="switch" aria-checked={row.enabled} aria-label={`启用 ${row.name}`} disabled={pendingIds.has(row.id)} onClick={() => invoke(() => toggle(row))} />
      <button type="button" className="smart-app-open" aria-label={`打开 ${row.name}`} data-open-module={row.source === 'module' ? row.record.manifest.id : undefined} onClick={() => invoke(() => row.source === 'app' ? props.openApp(row.app.id) : props.openModule(row.record.manifest.id))}>
        <span className="smart-app-mark">{row.name.slice(0, 1)}</span>
        <span className="smart-app-name">{row.name}</span>
        <span className="smart-app-kind">{row.label}</span>
        <small>{row.description}</small>
      </button>
      <div className="smart-app-row-actions">
        {row.source === 'app' && (
          <>
            <button type="button" className="secondary-button" onClick={() => invoke(() => props.editApp(row.app))}>编辑</button>
            <button type="button" className="secondary-button" onClick={() => invoke(() => props.removeApp(row.app))}>删除</button>
          </>
        )}
      </div>
    </article>
  )

  if (!rows.length) {
    return (
      <div className="smart-apps-list">
        <p className="smart-apps-empty">这里还没有应用。创建一个网页工具，或生成你的第一个小应用。</p>
      </div>
    )
  }
  if (!virtualized) {
    return (
      <div className="smart-apps-list" role="list" aria-label="应用与工具列表">
        {rows.map(row => <div key={row.id} role="listitem">{card(row.original)}</div>)}
      </div>
    )
  }
  return (
    <div ref={scroll} className="smart-apps-list smart-apps-list-virtual" role="list" aria-label="应用与工具列表" tabIndex={0}>
      <div className="smart-apps-virtual-content" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(item => (
          <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} className="smart-apps-virtual-row" role="listitem" aria-setsize={rows.length} aria-posinset={item.index + 1} style={{ transform: `translateY(${item.start}px)` }}>
            {card(rows[item.index].original)}
          </div>
        ))}
      </div>
    </div>
  )
}

// Keep the imperative view's open()/refresh contract synchronous while React owns
// only this host. Updating list props has no runner or dialog cleanup effects.
export function mountSmartAppsList(host: HTMLElement, props: SmartAppsListProps) {
  const root = createRoot(host)
  const update = (next: SmartAppsListProps) => {
    flushSync(() => root.render(<SmartAppsList {...next} />))
  }
  update(props)
  return {
    update,
    dispose: () => root.unmount(),
  }
}
