import {
  requestDrawerAuthentication,
} from '../auth/authEvents'

export async function drawerFetch(
  input:
    | RequestInfo
    | URL,

  init?: RequestInit,
): Promise<Response> {
  const response =
    await fetch(
      input,
      init,
    )

  if (response.status === 401) {
    requestDrawerAuthentication()
  }

  return response
}
