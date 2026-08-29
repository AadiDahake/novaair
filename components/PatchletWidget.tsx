import Script from 'next/script'

/**
 * The Patchlet widget script tag.
 *
 * It renders only when both the widget URL and the key are set in the environment. NovaAir holds no
 * other code for the widget: the widget reads the live page itself.
 */
export function PatchletWidget() {
  const src = process.env.NEXT_PUBLIC_PATCHLET_WIDGET_URL
  const dataKey = process.env.NEXT_PUBLIC_PATCHLET_KEY
  if (!src || !dataKey) return null
  return <Script src={src} data-key={dataKey} strategy="afterInteractive" />
}
