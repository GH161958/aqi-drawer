export const drawerAuthRequiredEvent =
  'aqi-drawer-auth-required'

export function requestDrawerAuthentication() {
  if (
    typeof window === 'undefined'
  ) {
    return
  }

  window.dispatchEvent(
    new Event(
      drawerAuthRequiredEvent,
    ),
  )
}
