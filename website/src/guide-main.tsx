import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import GuidePage from './guide-page'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GuidePage />
  </StrictMode>
)
