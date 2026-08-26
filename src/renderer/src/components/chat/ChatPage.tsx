import { MessageList } from './MessageList'
import { InputArea } from './InputArea'
import { ActivityPanel } from '../activity/ActivityPanel'
import { useActivityStore } from '@renderer/stores/activity-store'

export function ChatPage() {
  const activities = useActivityStore((s) => s.activities)

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Left: Chat area */}
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex-1 min-h-0">
          <MessageList />
        </div>
        <InputArea />
      </div>

      {/* Right: Activity panel (collapsible) */}
      {activities.length > 0 && <ActivityPanel />}
    </div>
  )
}
