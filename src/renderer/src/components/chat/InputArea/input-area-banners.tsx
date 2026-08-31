import * as React from 'react'
import { ComposerBanners } from './composer-banners'

type InputAreaBannersProps = Omit<React.ComponentProps<typeof ComposerBanners>, 'onOpenSettings'> & {
  openSettings: (tab: string) => void
}

export function InputAreaBanners({ openSettings, ...props }: InputAreaBannersProps): React.JSX.Element {
  return <ComposerBanners {...props} onOpenSettings={openSettings} />
}
