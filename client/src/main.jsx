import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './reference_site.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

const savedTheme = localStorage.getItem('dc-theme')
if (savedTheme === 'dark' || savedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', savedTheme)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* ErrorBoundary sits inside BrowserRouter (not outside it) so a render
        throw doesn't take routing/history down with it — <Link>/navigate()
        on the fallback screen, and a future retry-without-reload, still have
        a router context to work with. It wraps <App /> rather than going
        any deeper (e.g. around <Routes>) so it's the single top-level catch
        for anything under the app, including code that runs before Routes
        does (see App.jsx's boot-time session restore effect). */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)

