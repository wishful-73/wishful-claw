import './assets/main.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installRendererErrorLogger } from './lib/error-logger'

// Install global error logger ASAP to catch early errors
installRendererErrorLogger()

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
