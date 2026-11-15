import { PageContentRuntime } from '~/assistantContent/runtime'
import { ClippingController } from '../clippings'

it('saves local source and notes, locates the quote after page changes and reports missing or ambiguous sources', async () => {
  document.body.innerHTML = '<main><p>Context before. <b>Quoted passage.</b> Context after.</p></main>'
  const range = document.createRange()
  range.selectNodeContents(document.querySelector('b')!)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  const runtime = new PageContentRuntime(document)
  const anchor = await runtime.handle({ command: 'quote-capture' })
  expect(anchor).toMatchObject({ exact: 'Quoted passage.', prefix: 'Context before. ', suffix: ' Context after.' })
  const data: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
    set: async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)) },
  }
  const controller = new ClippingController(storage)
  const clipping = await controller.save({ anchor, url: 'https://example.org/article?part=2#source', title: 'Article', note: 'My note' })
  const restored = new ClippingController(storage)
  expect(await restored.list()).toEqual([clipping])
  await restored.note(clipping.id, 'Edited note')
  expect((await restored.list())[0]).toMatchObject({ note: 'Edited note', url: 'https://example.org/article?part=2#source' })
  document.querySelector('main')!.prepend(document.createTextNode('Inserted before everything.'))
  expect(await runtime.handle({ command: 'quote-locate', anchor: clipping.anchor })).toMatchObject({ status: 'found' })
  document.querySelector('main')!.append(document.querySelector('p')!.cloneNode(true))
  expect(await runtime.handle({ command: 'quote-locate', anchor: clipping.anchor })).toMatchObject({ status: 'ambiguous' })
  document.querySelector('main')!.textContent = 'An entirely different article.'
  expect(await runtime.handle({ command: 'quote-locate', anchor: clipping.anchor })).toMatchObject({ status: 'missing' })
  await expect(restored.note(clipping.id, 'x'.repeat(65537))).rejects.toThrow('大小')
  await restored.delete(clipping.id)
  expect(await restored.list()).toEqual([])
  runtime.dispose()
})
