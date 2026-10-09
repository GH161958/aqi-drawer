const easeOut =
  'cubic-bezier(0.23, 1, 0.32, 1)'

const drawerEase =
  'cubic-bezier(0.32, 0.72, 0, 1)'

const reducedMotionQuery =
  '(prefers-reduced-motion: reduce)'

const activeAnimations =
  new WeakMap<
    HTMLButtonElement,
    Animation[]
  >()

function computedTransform(
  element: HTMLElement,
) {
  return window
    .getComputedStyle(element)
    .transform
}

function withTransform(
  base: string,
  addition: string,
) {
  return base === 'none'
    ? addition
    : `${base} ${addition}`
}

function runAnimation(
  element: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) {
  return element.animate(
    keyframes,
    {
      fill: 'forwards',
      ...options,
    },
  )
}

async function animationFinished(
  animation: Animation,
) {
  try {
    await animation.finished
    return true
  } catch {
    return false
  }
}

export function cancelCabinetDrawerMotion(
  trigger: HTMLButtonElement,
) {
  const animations =
    activeAnimations.get(trigger)

  animations?.forEach(
    (animation) => {
      animation.cancel()
    },
  )

  activeAnimations.delete(trigger)

  delete trigger.dataset.motionActive
}

export async function animateCabinetDrawerPull(
  trigger: HTMLButtonElement,
  hasContents: boolean,
) {
  cancelCabinetDrawerMotion(
    trigger,
  )

  trigger.dataset.motionActive =
    'true'

  const front =
    trigger.querySelector<HTMLElement>(
      '[data-drawer-front]',
    )

  const paper =
    trigger.querySelector<HTMLElement>(
      '[data-drawer-paper]',
    )

  const label =
    trigger.querySelector<HTMLElement>(
      '[data-drawer-label]',
    )

  const pull =
    trigger.querySelector<HTMLElement>(
      '[data-drawer-pull]',
    )

  const reduced =
    window.matchMedia(
      reducedMotionQuery,
    ).matches

  const animations: Animation[] = []

  if (reduced) {
    const target =
      front ?? trigger

    animations.push(
      runAnimation(
        target,
        [
          {
            opacity: 1,
          },
          {
            opacity: .94,
            offset: .44,
          },
          {
            opacity: 1,
          },
        ],
        {
          duration: 120,
          easing: easeOut,
        },
      ),
    )

    activeAnimations.set(
      trigger,
      animations,
    )

    const results =
      await Promise.all(
        animations.map(
          animationFinished,
        ),
      )

    return results.every(Boolean)
  }

  const pullDuration =
    hasContents
      ? 300
      : 260

  const frontTarget =
    front ?? trigger

  const frontBase =
    computedTransform(
      frontTarget,
    )

  animations.push(
    runAnimation(
      frontTarget,
      [
        {
          transform:
            withTransform(
              frontBase,
              'scale(1)',
            ),
          offset: 0,
          easing: easeOut,
        },
        {
          transform:
            withTransform(
              frontBase,
              'scale(.994)',
            ),
          offset: .22,
          easing: drawerEase,
        },
        {
          transform:
            withTransform(
              frontBase,
              hasContents
                ? 'scale(1.036)'
                : 'scale(1.026)',
            ),
          offset: 1,
        },
      ],
      {
        duration: pullDuration,
      },
    ),
  )

  if (label) {
    const base =
      computedTransform(label)

    animations.push(
      runAnimation(
        label,
        [
          {
            transform:
              withTransform(
                base,
                'scale(1)',
              ),
            offset: 0,
            easing: easeOut,
          },
          {
            transform:
              withTransform(
                base,
                'scale(.997)',
              ),
            offset: .20,
            easing: drawerEase,
          },
          {
            transform:
              withTransform(
                base,
                'scale(1.018)',
              ),
            offset: 1,
          },
        ],
        {
          duration:
            hasContents
              ? 255
              : 225,
          delay: 20,
        },
      ),
    )
  }

  if (pull) {
    const base =
      computedTransform(pull)

    animations.push(
      runAnimation(
        pull,
        [
          {
            transform:
              withTransform(
                base,
                'scale(1)',
              ),
            offset: 0,
            easing: easeOut,
          },
          {
            transform:
              withTransform(
                base,
                'scale(.99)',
              ),
            offset: .18,
            easing: drawerEase,
          },
          {
            transform:
              withTransform(
                base,
                'scale(1.06)',
              ),
            offset: 1,
          },
        ],
        {
          duration:
            hasContents
              ? 245
              : 215,
          delay: 25,
        },
      ),
    )
  }

  if (
    paper
    && hasContents
  ) {
    const base =
      computedTransform(paper)

    animations.push(
      runAnimation(
        paper,
        [
          {
            transform: base,
            offset: 0,
            easing: easeOut,
          },
          {
            transform:
              withTransform(
                base,
                'translateY(-1px) scale(1.003)',
              ),
            offset: .42,
            easing: drawerEase,
          },
          {
            transform:
              withTransform(
                base,
                'translateY(-2px) scale(1.008)',
              ),
            offset: 1,
          },
        ],
        {
          duration: 240,
          delay: 35,
        },
      ),
    )
  }

  activeAnimations.set(
    trigger,
    animations,
  )

  const results =
    await Promise.all(
      animations.map(
        animationFinished,
      ),
    )

  return results.every(Boolean)
}
