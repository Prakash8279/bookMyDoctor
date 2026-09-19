import { Component } from 'react'

// React error boundaries can only be class components — there is no hook
// equivalent (getDerivedStateFromError/componentDidCatch have no useState/
// useEffect analogue as of React 19) — so this one exception to the rest of
// the codebase's function-component convention is required, not a style
// choice.
//
// Without this, any render-time throw anywhere under <App /> (a bad API
// response shape, a null a page forgot to guard, a third-party widget
// misbehaving) unmounts the whole React tree and leaves the visitor staring
// at a blank white page with no way back short of manually editing the URL.
// Wrapping the app once here means that failure instead lands on a small,
// readable "something went wrong" screen with a way to recover.
//
// There is no external error-tracking service (Sentry or similar) wired up
// anywhere in this codebase — componentDidCatch below only console.errors
// the failure, which is enough for local/dev visibility but not for
// production monitoring. Wiring a real error-tracking service here is a
// natural follow-up once one is chosen and its credentials exist.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  // Called during the render phase after a descendant throws — used only to
  // flip render output to the fallback UI, so it must stay a pure state
  // update (no side effects here; those belong in componentDidCatch below).
  static getDerivedStateFromError() {
    return { hasError: true }
  }

  // Called during the commit phase, after getDerivedStateFromError — this is
  // where side effects like logging are safe to run. `info.componentStack`
  // is included because the bare error alone often doesn't say which page/
  // component threw.
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Unhandled error in the component tree:', error, info?.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid min-h-screen place-items-center bg-surface p-6">
          <div className="w-full max-w-sm rounded-card border border-border bg-white p-8 text-center shadow-card">
            <h1 className="text-2xl">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted">
              Sorry about that — this page hit an unexpected error. Reloading usually fixes it.
            </p>
            <button type="button" className="btn-primary mt-6 w-full" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
