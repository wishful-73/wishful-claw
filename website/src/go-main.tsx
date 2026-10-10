import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import GoPage from './go-page'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoPage />
  </StrictMode>
)
