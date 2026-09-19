// `required` used to be destructured out only to decide whether to draw the red "*" — it was
// never spread back onto the actual <select>/<input>/<textarea>, so every "required" field across
// the app (this component is shared everywhere) looked mandatory but the browser never enforced
// it. A field left empty (e.g. the "Clinic"/"Day" selects on the OPD-schedule page) would submit
// straight through to the form's own JS handler, which then had to notice the empty value itself
// and surface whatever error message it had for that case — confusing when the field the user
// was actually looking at (e.g. "Patient time") had nothing wrong with it. Now passed through for
// real, so the browser blocks submission and points at the actual empty field.
export function FormField({ label, type = 'text', placeholder, options = [], required = false, ...inputProps }) { return <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink">{label}{required && <span className="text-error"> *</span>}</span>{type === 'select' ? <select className="min-h-11 w-full rounded-button border border-border bg-white px-3 text-sm outline-none focus:border-primary-dark" required={required} {...inputProps}><option value="">Select {label}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : type === 'textarea' ? <textarea className="min-h-24 w-full rounded-button border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary-dark" placeholder={placeholder} required={required} {...inputProps} /> : <input className="min-h-11 w-full rounded-button border border-border bg-white px-3 text-sm outline-none focus:border-primary-dark" type={type} placeholder={placeholder} required={required} {...inputProps} />}</label> }

