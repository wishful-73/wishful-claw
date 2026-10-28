import { useTranslation } from 'react-i18next'
import { Loader2, Sparkles } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@renderer/components/ui/dropdown-menu'
import { WISHFUL_CLAW_DATA_DIR_NAME } from '@shared/data-dir'
import type { SkillItem } from './types'

interface SkillsSubmenuProps {
  visibleSkills: SkillItem[]
  loading: boolean
  menuClassName?: string
  onSelectSkill: (skillName: string) => void
  setOpen: (open: boolean) => void
}

export function SkillsSubmenu({
  visibleSkills,
  loading,
  menuClassName,
  onSelectSkill,
  setOpen
}: SkillsSubmenuProps): React.JSX.Element {
  const { t } = useTranslation('chat')

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Sparkles className="mr-2 size-4" />
        <span>{t('skills.skillsLabel')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={cn('w-64 max-h-80 overflow-y-auto', menuClassName)}>
          <DropdownMenuLabel>{t('skills.availableSkills')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {loading ? (
            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              {t('skills.loadingSkills')}
            </div>
          ) : visibleSkills.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              <p>{t('skills.noSkills')}</p>
              <p className="mt-1 text-[10px] opacity-70">{`~/${WISHFUL_CLAW_DATA_DIR_NAME}/skills/`}</p>
            </div>
          ) : (
            visibleSkills.map((skill) => (
              <DropdownMenuItem
                key={skill.name}
                onClick={() => {
                  onSelectSkill(skill.name)
                  setOpen(false)
                }}
                className="flex flex-col items-start gap-1 py-2"
              >
                <span className="font-medium">{skill.name}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {skill.description}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}
