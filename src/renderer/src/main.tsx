import './assets/main.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installRendererErrorLogger } from './lib/error-logger'

// Install global error logger ASAP to catch early errors
installRendererErrorLogger()

// S-247 §13.4：内存构成探针，只在 dev 跑。定性完连 lib/diagnostics 目录一起删。
if (import.meta.env.DEV) {
  void import('./lib/diagnostics/renderer-memory-probe').then((m) => m.startRendererMemoryProbe())
}

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
