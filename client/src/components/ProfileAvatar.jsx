import { useEffect, useState } from 'react'
import { resolveMediaUrl } from '../lib/mediaUrl'

export function ProfileAvatar({ src, alt = 'Profile', fallback = 'U', className = '', imageClassName = '' }) {
  const resolved = resolveMediaUrl(src)
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [resolved])

  return <span className={`relative grid overflow-hidden place-items-center ${className}`}>
    <span aria-hidden="true">{fallback}</span>
    {resolved && !failed && <img src={resolved} alt={alt} onError={() => setFailed(true)} className={`absolute inset-0 h-full w-full object-cover ${imageClassName}`} />}
  </span>
}
