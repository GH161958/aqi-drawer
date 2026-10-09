import styles from './AuxiliaryReturn.module.css'

interface AuxiliaryReturnProps {
  onClick: () => void
}

export function AuxiliaryReturn({
  onClick,
}: AuxiliaryReturnProps) {
  return (
    <button
      type="button"
      className={styles.action}
      onClick={onClick}
    >
      <span>
        放回这张
      </span>
    </button>
  )
}
