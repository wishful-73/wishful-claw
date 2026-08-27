import { MessageList } from './MessageList'
import { InputArea } from './InputArea'

export function ChatPage() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex-1 min-h-0">
          <MessageList />
        </div>
        <InputArea />
      </div>
    </div>
  )
}
