interface DrawerSessionPayload {
  authenticated?: boolean
  error?: string
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value),
  )
}

async function readPayload(
  response: Response,
): Promise<DrawerSessionPayload> {
  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!isRecord(payload)) {
    return {}
  }

  return {
    authenticated:
      payload.authenticated === true,

    error:
      typeof payload.error === 'string'
        ? payload.error
        : undefined,
  }
}

export async function getDrawerSession():
  Promise<boolean> {
  const response =
    await fetch(
      '/drawer/session',
      {
        credentials:
          'same-origin',

        headers: {
          accept:
            'application/json',
        },
      },
    )

  const payload =
    await readPayload(response)

  if (!response.ok) {
    throw new Error(
      payload.error
      || `Session check failed (${response.status}).`,
    )
  }

  return (
    payload.authenticated
    === true
  )
}

export async function openDrawerSession(
  secret: string,
): Promise<void> {
  const response =
    await fetch(
      '/drawer/session',
      {
        method:
          'POST',

        credentials:
          'same-origin',

        headers: {
          'content-type':
            'application/json',

          accept:
            'application/json',
        },

        body:
          JSON.stringify({
            secret,
          }),
      },
    )

  const payload =
    await readPayload(response)

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        '这把钥匙没有打开抽屉。',
      )
    }

    if (response.status === 403) {
      throw new Error(
        '这次打开请求不是从当前 Drawer 发出的。',
      )
    }

    throw new Error(
      payload.error
      || `暂时打不开（${response.status}）。`,
    )
  }

  if (
    payload.authenticated
    !== true
  ) {
    throw new Error(
      'Drawer 没有确认这次打开。',
    )
  }
}
