import * as React from 'react'
import { isRecord, readStringProp, stringifyData } from './extension-tool-helpers'
import { useExtensionStore } from '../../stores/extension-store'
import { ExtensionToolResult } from '@renderer/lib/extensions/extension-result'
import { CardRenderer, TableRenderer, FormRenderer, ChartRenderer, ExtensionHtmlRenderer, ExtensionAssetHtmlRenderer } from './extension-tool-renderers'

export function ExtensionComponentRenderer({
  result,
  ui
}: {
  result: ExtensionToolResult
  ui: Record<string, unknown>
}): React.JSX.Element | null {
  const props = isRecord(ui.props) ? ui.props : ui
  const component = readStringProp(ui, ['component', 'name', 'renderer'])
  const extension = useExtensionStore((state) =>
    state.extensions.find((item) => item.id === result.extensionId)
  )
  const customComponent = extension?.manifest.components?.find((item) => item.name === component)

  if (customComponent) {
    return (
      <ExtensionAssetHtmlRenderer
        extensionId={result.extensionId}
        assetPath={customComponent.entry}
        title={customComponent.title ?? customComponent.name}
        props={props}
      />
    )
  }

  return (
    <CardRenderer
      ui={{
        title: component || 'Extension component',
        subtitle: result.extensionId,
        body: stringifyData(props)
      }}
    />
  )
}

export function SchemaRenderer({ result }: { result: ExtensionToolResult }): React.JSX.Element | null {
  const ui = isRecord(result.ui) ? result.ui : null
  if (!ui) return null
  const kind = ui.kind
  if (kind === 'card') return <CardRenderer ui={ui} />
  if (kind === 'table') return <TableRenderer ui={ui} fallbackData={result.data} />
  if (kind === 'form') return <FormRenderer ui={ui} />
  if (kind === 'chart') return <ChartRenderer ui={ui} />
  if (kind === 'html') return <ExtensionHtmlRenderer result={result} ui={ui} />
  if (kind === 'component') return <ExtensionComponentRenderer result={result} ui={ui} />
  return null
}

