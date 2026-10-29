import { useMemo } from 'react'
import QRCode from 'qrcode'

/** Renders `value` as a QR code. The encoded text is exactly `value`, nothing added. */
export function QrCode({ value, size = 224, label }: { value: string; size?: number; label: string }) {
  const { modules, count } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' })
    return { modules: qr.modules.data, count: qr.modules.size }
  }, [value])

  const path = useMemo(() => {
    let d = ''
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (modules[y * count + x]) d += `M${x} ${y}h1v1h-1z`
      }
    }
    return d
  }, [modules, count])

  const margin = 3
  const total = count + margin * 2
  return (
    <svg viewBox={`0 0 ${total} ${total}`} width={size} height={size} role="img" aria-label={label} className="max-w-full rounded-xl bg-white" shapeRendering="crispEdges">
      <rect width={total} height={total} fill="#fff" />
      <path transform={`translate(${margin} ${margin})`} d={path} fill="#111827" />
    </svg>
  )
}
