import { useState } from 'react'

// Shared "confirm, then delete with a busy state" flow.
// Extracted from PortalSectionPages.jsx's Specializations.remove and AdminPages.jsx's
// CitiesAreas.removeCity/removeArea — all three already had this exact
// window.confirm -> setDeletingId -> try/catch/finally shape — plus PatientPages.jsx's
// Family.remove, which had NO busy-state at all (a double-click on "Remove" could fire
// removeFamilyMember twice before the first request resolved). Found during the duplication
// audit (2026-09-05).
//
// Deliberately takes the caller's own `setError` (rather than owning a separate error state) so
// this keeps writing into the same single error slot each page already shows above/below its
// add/edit form — no rendering behavior changes for the 3 call sites that already worked
// correctly, and Family.remove gains the missing busy state as the one real behavior change.

/**
 * @param {object} options
 * @param {(item: any) => Promise<any>} options.deleteFn - performs the actual delete for one item/row
 * @param {(item: any) => string} options.confirmMessage - builds the window.confirm() message for one item
 * @param {string} [options.errorFallback] - shown if the thrown error has no `.message`
 * @param {(message: string) => void} options.setError - the caller's existing error-state setter
 * @returns {{ deletingId: string|null, remove: (item: any) => Promise<void> }}
 */
export function useDeleteWithConfirm({ deleteFn, confirmMessage, errorFallback = 'Could not delete this item.', setError }) {
  const [deletingId, setDeletingId] = useState(null)

  const remove = async (item) => {
    if (!window.confirm(confirmMessage(item))) return
    setDeletingId(item.id)
    setError('')
    try {
      await deleteFn(item)
    } catch (err) {
      setError(err.message || errorFallback)
    } finally {
      setDeletingId(null)
    }
  }

  return { deletingId, remove }
}
