const paths: Record<string, string> = {
  translate: 'm4 5 9 0m-4-2v2m-3 0c0 5 4 9 7 10m-2-10c0 5-4 9-8 11m12-5-4 10m4-10 4 10m-6-4h5',
  explain: 'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9z',
  summarize: 'M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h5',
  rewrite: 'm4 20 4-1L20 7l-3-3L5 16zm10-13 3 3M4 20h16',
  continue: 'M4 4h16v12H9l-5 4zM8 9h8m-8 3h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  ask: 'M4 4h16v12H9l-5 4zM9 8a3 3 0 0 1 6 0c0 2-3 1-3 4m0 2h.01',
  clip: 'M7 3h10v18l-5-4-5 4z',
  video: 'M3 5h18v14H3zm7 3 5 4-5 4z',
  vision: 'M8 5 10 3h4l2 2h5v15H3V5zm1 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  toolbox: 'M3 5h7v6H3zm11 0h7v6h-7zM3 15h7v6H3zm11 0h7v6h-7z',
  grammar: 'm3 16 5-12 5 12m-8-4h6m4 4 2 2 4-5',
  answer: 'M4 4h16v12H9l-5 4zM9 8a3 3 0 0 1 6 0c0 2-3 1-3 4m0 2h.01',
  pin: 'M8 3h8l-2 7 4 4H6l4-4zM12 14v7',
  close: 'm6 6 12 12M6 18 18 6',
  grip: 'm9 5h.01m6 0h.01M9 12h.01m6 0h.01M9 19h.01m6 0h.01',
  up: 'm6 14 6-6 6 6',
  down: 'm6 10 6 6 6-6',
  read: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1z',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M10 15v6',
}

export function surfaceIcon(document: Document, name: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', paths[name] ?? paths.rewrite)
  svg.append(path)
  return svg
}
