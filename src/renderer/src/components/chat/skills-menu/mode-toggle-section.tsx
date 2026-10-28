import { useTranslation } from 'react-i18next'
import { ClipboardList, Target } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@renderer/components/ui/dropdown-menu'

interface ModeToggleSectionProps {
  planModeEnabled?: boolean
  goalModeEnabled?: boolean
  planModeDisabled?: boolean
  goalModeDisabled?: boolean
  onPlanModeChange?: (enabled: boolean) => void
  onGoalModeChange?: (enabled: boolean) => void
}

export function ModeToggleSection({
  planModeEnabled = false,
  goalModeEnabled = false,
  planModeDisabled = false,
  goalModeDisabled = false,
  onPlanModeChange,
  onGoalModeChange
}: ModeToggleSectionProps): React.JSX.Element {
  const { t } = useTranslation('chat')

  return (
    <>
      <DropdownMenuGroup>
        {onPlanModeChange && (
          <DropdownMenuItem
            disabled={planModeDisabled}
            onSelect={(event) => {
              event.preventDefault()
              onPlanModeChange(!planModeEnabled)
            }}
            className="justify-between"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ClipboardList className="size-4" />
              <span>{t('input.planModeMenu', { defaultValue: 'Plan Mode' })}</span>
            </span>
            <Switch
              size="sm"
              checked={planModeEnabled}
              disabled={planModeDisabled}
              tabIndex={-1}
              className="pointer-events-none ml-3"
            />
          </DropdownMenuItem>
        )}
        {onGoalModeChange && (
          <DropdownMenuItem
            disabled={goalModeDisabled}
            onSelect={(event) => {
              event.preventDefault()
              onGoalModeChange(!goalModeEnabled)
            }}
            className="justify-between"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Target className="size-4" />
              <span>{t('input.pursueGoalMenu', { defaultValue: 'Pursue Goal' })}</span>
            </span>
            <Switch
              size="sm"
              checked={goalModeEnabled}
              disabled={goalModeDisabled}
              tabIndex={-1}
              className="pointer-events-none ml-3"
            />
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
    </>
  )
}
