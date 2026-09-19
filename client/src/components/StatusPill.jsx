import { Badge } from './Badge'
const tones = { running: 'success', serving: 'teal', waiting: 'gold', called: 'gold', 'in consultation': 'gold', paused: 'gold', closed: 'neutral', upcoming: 'teal', confirmed: 'teal', completed: 'success', cancelled: 'error', no_show: 'error', pending: 'gold', pending_payment: 'error', partial: 'gold', on_hold: 'error', approved: 'success', paid: 'success', active: 'success', in_review: 'gold', in_progress: 'gold', open: 'error', resolved: 'success', rejected: 'error', responded: 'teal' }
export function StatusPill({ status }) { return <Badge tone={tones[status] || 'neutral'}>{String(status).replace('_', ' ')}</Badge> }

