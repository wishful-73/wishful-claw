import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import DownloadPage from './download-page'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DownloadPage />
  </StrictMode>
)
