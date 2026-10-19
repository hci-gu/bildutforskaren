import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import 'react-photo-view/dist/react-photo-view.css'
import App from './app/App'
import { currentLanguage } from './shared/i18n'

document.documentElement.lang = currentLanguage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
